#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQ 邮箱告警推送服务（复刻原站 /api/Email?QQ=xxx&type=xxx 那套）

浏览器无法直连 SMTP，故由本服务代发：前端只传 QQ 号与正文，
发件邮箱与 SMTP 授权码只配在本机环境变量里，不进浏览器。

前置：QQ 邮箱需先在「设置 → 账户 → POP3/SMTP 服务」开启，拿到 16 位「授权码」（不是登录密码）。

启动：
    SMTP_USER=你的QQ@qq.com SMTP_PASS=你的授权码 /usr/bin/python3 backend_notify.py

接口：
    POST /api/notify/qqmail   {"qq":"123456","title":"告警","content":"正文"}
    GET  /api/Email?QQ=123456&type=jiankong4    （兼容原站格式）
    GET  /api/health                             （查看是否已配置 / 今日剩余额度）

端口默认 8011（可用 NOTIFY_PORT 覆盖；8010 已被 backend_gold.py 占用）
"""
import os
import re
import smtplib
import ssl
from datetime import datetime
from email.header import Header
from email.mime.text import MIMEText
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.qq.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', '465'))  # QQ 邮箱 SSL 端口
SMTP_USER = os.getenv('SMTP_USER', '')  # 发件邮箱
SMTP_PASS = os.getenv('SMTP_PASS', '')  # SMTP 授权码（非登录密码）
MAIL_FROM = os.getenv('MAIL_FROM', '') or SMTP_USER
DAILY_LIMIT = int(os.getenv('DAILY_LIMIT', '20'))  # 每日上限（对齐原站 20 封/天）
NOTIFY_PORT = int(os.getenv('NOTIFY_PORT', '8011'))

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
    }


if __name__ == '__main__':
    import uvicorn

    print(f'[notify] starting on 0.0.0.0:{NOTIFY_PORT}  from={MAIL_FROM or "(未配置)"}')
    uvicorn.run(app, host='0.0.0.0', port=NOTIFY_PORT)
