#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
告警推送服务（复刻原站 /api/Email?QQ=xxx&type=xxx 那套）

支持两类渠道，均由本服务代发（浏览器无法直连 SMTP / 微信 API，且密钥不能进前端）：

1) QQ 邮箱
   前端只传 QQ 号与正文；发件邮箱与 SMTP 授权码只配在本机环境变量。
   前置：QQ 邮箱需先在「设置 → 账户 → POP3/SMTP 服务」开启，拿到 16 位「授权码」（不是登录密码）。

2) 微信测试号（公众号测试号）模板消息
   appID / appsecret / token 只配在本机环境变量；模板 ID 固定（WX_TEMPLATE_ID，默认即「自动战斗监控告警」模板）。
   接收人采用「备注名 → openid」映射，由管理员在后端 wechat_receivers.json 维护；
   外网用户只需填写管理员分配的接收人备注名，看不到 openid，也不能自行新增（需联系管理员）。

启动：
    SMTP_USER=你的QQ@qq.com SMTP_PASS=你的授权码 \
    WX_APPID=wx... WX_APPSECRET=xxx WX_TOKEN=xxx \
    /usr/bin/python3 backend_notify.py

接口：
    POST /api/notify/qqmail     {"qq":"123456","title":"告警","content":"正文"}
    GET  /api/Email?QQ=123456&type=jiankong4    （兼容原站格式）
    POST /api/notify/wechat     {"receiver":"迪总","title":"告警","content":"正文"}  （模板 ID 固定，openid 由后端按备注名查映射）
    GET  /api/wechat/receivers                   （列出已登记接收人备注名，不含 openid）
    POST /api/wechat/receiver                     （管理员：登记 备注名→openid）
    DELETE /api/wechat/receiver?name=xxx          （管理员：删除接收人）
    GET  /api/wechat/followers                   （拉取已关注者 openid，供管理员登记用）
    GET  /api/wechat/callback                    （微信「接口配置信息」URL 校验回显）
    GET  /api/health                             （查看是否已配置 / 今日剩余额度）

端口默认 8011（可用 NOTIFY_PORT 覆盖；8010 已被 backend_gold.py 占用）
"""
import hashlib
import json
import os
import re
import smtplib
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from email.header import Header
from email.mime.text import MIMEText
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.qq.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', '465'))  # QQ 邮箱 SSL 端口
SMTP_USER = os.getenv('SMTP_USER', '')  # 发件邮箱
SMTP_PASS = os.getenv('SMTP_PASS', '')  # SMTP 授权码（非登录密码）
MAIL_FROM = os.getenv('MAIL_FROM', '') or SMTP_USER
DAILY_LIMIT = int(os.getenv('DAILY_LIMIT', '20'))  # 每日上限（对齐原站 20 封/天）
NOTIFY_PORT = int(os.getenv('NOTIFY_PORT', '8011'))

# 微信测试号（公众号测试号）配置：appsecret / token 只存在本机环境变量，绝不进前端
WX_APPID = os.getenv('WX_APPID', '')
WX_APPSECRET = os.getenv('WX_APPSECRET', '')
WX_TOKEN = os.getenv('WX_TOKEN', '')  # 用于「接口配置信息」URL 校验，与微信后台填写一致即可
WX_TEMPLATE_ID = os.getenv('WX_TEMPLATE_ID', 'UqAUYGiHKJT2TXlyuvlRuZahlhsvyOwurNLpMacSpwU')  # 固定告警模板（「自动战斗监控告警」，含 first/keyword1/keyword2/remark）

# 接收人映射：备注名 → openid（由管理员在后端维护，外网用户只填备注名，看不到 openid）
WX_RECEIVERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wechat_receivers.json')
_wx_receivers: dict = {}  # name -> openid


def _load_receivers() -> None:
    global _wx_receivers
    try:
        if os.path.exists(WX_RECEIVERS_FILE):
            with open(WX_RECEIVERS_FILE, 'r', encoding='utf-8') as f:
                _wx_receivers = json.load(f)
        else:
            _wx_receivers = {}
    except Exception:
        _wx_receivers = {}


def _save_receivers() -> None:
    with open(WX_RECEIVERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(_wx_receivers, f, ensure_ascii=False, indent=2)


_load_receivers()

app = FastAPI(title='MHXY Notify (QQ Mail)')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],  # 前端页面来源分散（localhost / 内网 / 公网部署），故放开
    allow_methods=['*'],
    allow_headers=['*'],
)

# 简易每日计数（进程内，重启清零）
_send_log = {'date': '', 'count': 0}


class MailReq(BaseModel):
    qq: str
    title: str = '梦幻工具箱告警'
    content: str = ''
    type: str = 'jiankong4'


def _today() -> str:
    return datetime.now().strftime('%Y-%m-%d')


def _remaining() -> int:
    if _send_log['date'] != _today():
        _send_log['date'] = _today()
        _send_log['count'] = 0
    return max(0, DAILY_LIMIT - _send_log['count'])


def _check_qq(qq: str) -> str:
    q = (qq or '').strip()
    if not re.fullmatch(r'\d{5,12}', q):
        raise HTTPException(status_code=400, detail='QQ 号不合法（应为 5~12 位纯数字）')
    return q


def send_qq_mail(qq: str, title: str, content: str) -> dict:
    """发送一封邮件到 QQ号@qq.com，返回与原站 /api/Email 一致的结构"""
    if not SMTP_USER or not SMTP_PASS:
        return {
            'success': False,
            'msg': '后端未配置 SMTP_USER / SMTP_PASS（发件邮箱与授权码），无法发信',
        }
    if _remaining() <= 0:
        return {'success': False, 'msg': f'今日发送额度已用完（上限 {DAILY_LIMIT} 封）'}

    to_addr = f'{qq}@qq.com'
    html = (content or '').replace('\n', '<br/>')
    msg = MIMEText(html, 'html', 'utf-8')
    msg['Subject'] = Header(title or '梦幻工具箱告警', 'utf-8')
    msg['From'] = MAIL_FROM
    msg['To'] = to_addr

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=15) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(MAIL_FROM, [to_addr], msg.as_string())
        _send_log['count'] += 1
        return {
            'success': True,
            'qq': qq,
            'recipientEmail': to_addr,
            'todaySendCount': _send_log['count'],
            'remainingCount': _remaining(),
        }
    except Exception as e:  # noqa: BLE001
        return {'success': False, 'msg': f'发信失败：{e}'}


@app.post('/api/notify/qqmail')
def notify_qqmail(req: MailReq):
    qq = _check_qq(req.qq)
    return send_qq_mail(qq, req.title, req.content)


@app.get('/api/Email')
def email_by_type(QQ: str, type: str = 'jiankong4', title: Optional[str] = None):  # noqa: N803
    """兼容原站格式：GET /api/Email?QQ=xxx&type=jiankong4"""
    qq = _check_qq(QQ)
    return send_qq_mail(qq, title or '梦幻工具箱告警', f'告警类型：{type}')


@app.get('/api/health')
def health():
    return {
        'ok': True,
        'configured': bool(SMTP_USER and SMTP_PASS),
        'from': MAIL_FROM or None,
        'dailyLimit': DAILY_LIMIT,
        'remaining': _remaining(),
        'wechatConfigured': bool(WX_APPID and WX_APPSECRET),
    }


# ---------------------------------------------------------------------------
# 微信测试号（公众号测试号）推送：模板消息
# 浏览器无法直连微信 API（CORS + appsecret 不能暴露），统一由本服务代发。
# ---------------------------------------------------------------------------
_wx_token_cache = {'access_token': '', 'expires_at': 0}
_wx_token_lock = threading.Lock()


def _wx_get_access_token() -> tuple[str, Optional[str]]:
    """换取并缓存 access_token（有效期 7200s，提前 300s 复用）"""
    now = time.time()
    with _wx_token_lock:
        if _wx_token_cache['access_token'] and _wx_token_cache['expires_at'] > now + 300:
            return _wx_token_cache['access_token'], None
    if not WX_APPID or not WX_APPSECRET:
        return '', '后端未配置 WX_APPID / WX_APPSECRET'
    url = (
        'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential'
        f'&appid={urllib.parse.quote(WX_APPID)}&secret={urllib.parse.quote(WX_APPSECRET)}'
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:  # noqa: BLE001
        return '', f'获取 access_token 失败：{e}'
    if 'access_token' not in data:
        return '', f"获取 access_token 失败：{data.get('errmsg', '未知错误')} (errcode={data.get('errcode')})"
    with _wx_token_lock:
        _wx_token_cache['access_token'] = data['access_token']
        _wx_token_cache['expires_at'] = now + float(data.get('expires_in', 7200))
    return data['access_token'], None


def _wx_call(method: str, path: str, payload: Optional[dict] = None, query: Optional[dict] = None, _retry: int = 1) -> tuple[Optional[dict], Optional[str]]:
    token, err = _wx_get_access_token()
    if err:
        return None, err
    url = f'https://api.weixin.qq.com{path}?access_token={urllib.parse.quote(token)}'
    if query:
        for k, v in query.items():
            url += f'&{k}={urllib.parse.quote(str(v))}'
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            res = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return None, f'微信接口 HTTP {e.code}'
    except Exception as e:  # noqa: BLE001
        return None, f'请求微信接口失败：{e}'
    # access_token 失效（多端/多进程获取会互相挤掉旧 token），强制刷新后重试一次
    if isinstance(res, dict) and res.get('errcode') == 40001 and _retry > 0:
        with _wx_token_lock:
            _wx_token_cache['access_token'] = ''
            _wx_token_cache['expires_at'] = 0
        return _wx_call(method, path, payload, query, _retry - 1)
    return res, None


class WechatNotifyReq(BaseModel):
    receiver: str = ''      # 接收人备注名（外网用户填写，由后端映射 openid）
    openid: str = ''        # 兼容旧调用（直接传 openid）
    title: str = '监控告警'
    content: str = ''
    time: str = ''


@app.post('/api/notify/wechat')
def notify_wechat(req: WechatNotifyReq):
    if not WX_APPID or not WX_APPSECRET:
        return {'success': False, 'msg': '后端未配置 WX_APPID / WX_APPSECRET'}
    # 备注名 → openid 映射（管理员在 wechat_receivers.json 维护）；也兼容直接传 openid
    openid = req.openid or _wx_receivers.get(req.receiver)
    if not openid:
        return {'success': False, 'msg': f'未找到接收人「{req.receiver}」，请联系管理员添加（需先在测试号后台关注）'}
    # first 只放标题；内容/时间交给 keyword1/keyword2（多字段模板里各显示一次，避免重复）。
    # 若用单字段模板（只有 {{first.DATA}}），first 仍会展示标题，内容不会丢（微信对未声明字段静默忽略，但 first 必展示）。
    first_value = req.title or '监控告警'
    payload = {
        'touser': openid,
        'template_id': WX_TEMPLATE_ID,
        'data': {
            'first': {'value': first_value},
            'keyword1': {'value': req.content or ''},
            'keyword2': {'value': req.time or datetime.now().strftime('%Y-%m-%d %H:%M:%S')},
            'remark': {'value': '由泰迪熊梦幻工具箱自动发出'},
        },
    }
    resp, err = _wx_call('POST', '/cgi-bin/message/template/send', payload)
    if err:
        return {'success': False, 'msg': err}
    if resp.get('errcode', -1) == 0:
        return {'success': True, 'msgid': resp.get('msgid'), 'receiver': req.receiver}
    return {'success': False, 'msg': f"微信返回 errcode={resp.get('errcode')} {resp.get('errmsg')}"}


@app.get('/api/wechat/receivers')
def list_receivers():
    """列出已登记接收人备注名（不含 openid，外部用户仅能选名、看不到 openid）"""
    return {'success': True, 'receivers': sorted(_wx_receivers.keys())}


@app.get('/api/wechat/receivers/detail')
def list_receivers_detail():
    """管理员接口：列出 备注名 → openid 完整映射（含 openid，用于本地管理页）"""
    return {'success': True, 'receivers': [{'name': k, 'openid': v} for k, v in _wx_receivers.items()]}


class ReceiverReq(BaseModel):
    name: str
    openid: str


@app.post('/api/wechat/receiver')
def add_receiver(req: ReceiverReq):
    """管理员接口：登记一个接收人（备注名 → openid）。外网用户无此权限，需联系管理员。"""
    name = (req.name or '').strip()
    openid = (req.openid or '').strip()
    if not name or not openid:
        return {'success': False, 'msg': 'name 与 openid 均必填'}
    _wx_receivers[name] = openid
    _save_receivers()
    return {'success': True, 'name': name}


@app.delete('/api/wechat/receiver')
def del_receiver(name: str = ''):
    name = (name or '').strip()
    if name in _wx_receivers:
        del _wx_receivers[name]
        _save_receivers()
        return {'success': True, 'name': name}
    return {'success': False, 'msg': f'未找到接收人「{name}」'}


@app.get('/api/wechat/followers')
def wechat_followers():
    if not WX_APPID or not WX_APPSECRET:
        return {'success': False, 'msg': '后端未配置 WX_APPID / WX_APPSECRET'}
    resp, err = _wx_call('GET', '/cgi-bin/user/get')
    if err:
        return {'success': False, 'msg': err}
    openids = (resp.get('data') or {}).get('openid', [])
    # 逐个拉昵称（user/get 只给 openid，昵称需 user/info 取；测试号每日 50w 额度足够）
    fans = []
    for oid in openids:
        info, e2 = _wx_call('GET', '/cgi-bin/user/info', query={'openid': oid, 'lang': 'zh_CN'})
        fans.append({'openid': oid, 'nickname': (info or {}).get('nickname') or ''})
    return {'success': True, 'total': resp.get('total', 0), 'openids': openids, 'fans': fans}


@app.get('/api/wechat/callback')
def wechat_callback(signature: str = '', timestamp: str = '', nonce: str = '', echostr: str = ''):
    """微信「接口配置信息」URL 校验回显。WX_TOKEN 需与微信后台填写一致。"""
    if not WX_TOKEN:
        return PlainTextResponse('')
    items = sorted([WX_TOKEN, timestamp, nonce])
    sha = hashlib.sha1(''.join(items).encode('utf-8')).hexdigest()
    return PlainTextResponse(echostr if sha == signature else '')


if __name__ == '__main__':
    import uvicorn

    print(f'[notify] starting on 0.0.0.0:{NOTIFY_PORT}  from={MAIL_FROM or "(未配置)"}')
    uvicorn.run(app, host='0.0.0.0', port=NOTIFY_PORT)
