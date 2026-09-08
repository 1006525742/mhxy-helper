# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

跨平台梦幻西游辅助工具 (Cross-platform Fantasy Westward Journey Helper)
- **Frontend**: Vue 3 + TypeScript + Vite (port 3000)
- **Backend**: Python FastAPI (port 8000 for game logic, port 8001 for OCR)
- **Features**: 科举答题 (Keju quiz), 抓鬼助手 (Ghost catching), 宝图助手 (Treasure map)

## Development Commands

### Start all services

```bash
# Frontend (Vite dev server)
cd /Users/zhy/mhxy-helper/frontend && npm run dev

# Game backend (port 8000)
cd /Users/zhy/mhxy-helper/backend && python3 main.py

# OCR backend (port 8001) - MUST run in Terminal outside WorkBuddy
cd /Users/zhy/mhxy-helper/backend && ./start_keju.sh
```

### Stop OCR backend
```bash
cat /tmp/keju_ocr.pid | xargs kill
```

### Build frontend
```bash
cd /Users/zhy/mhxy-helper/frontend && npm run build
```

## Architecture

### Three-service architecture

```
Browser (localhost:3000)
    ├── Vite Dev Server (3000)
    │   ├── /mhxy/static/keju.html  - Quiz page
    │   ├── /ghost                    - Ghost helper
    │   ├── /baotu                    - Treasure map
    │   └── /api/* → proxy to backends
    │
    └── Game Backend (8000) - main.py
        ├── /api/recognize    - Template matching coordinates
        ├── /api/predict      - Ghost prediction
        ├── /api/ghost/capture - OCR + template matching comparison
        └── /api/maps         - Map list

    └── OCR Backend (8001) - backend_keju.py
        ├── /api/ocr/general  - PP-OCRv6 recognition
        └── /api/hash-db/collect - Hash crowd collection
```

### Key services

| Service | Port | Python | Purpose |
|---------|------|--------|---------|
| Vite frontend | 3000 | - | Vue 3 + static HTML |
| Game backend | 8000 | Any | Template matching, ghost prediction |
| OCR backend | 8001 | **3.9 only** | PP-OCRv6 for quiz |

### Critical constraint

**OCR backend must use Python 3.9** (`/usr/bin/python3`). Python 3.13 venv lacks rapidocr dependencies.

## Ghost Recognition Flow

```
Frontend (YOLO detection)
    ↓ Task track (class 0) + Zhong Kui (class 1) + Yellow pixels >= 500
    ↓ Crop region below task track bbox
    ↓ POST /api/ghost/capture with base64 image

Backend
    ↓ Yellow text extraction (HSV filtering)
    ↓ OCR recognition (PP-OCRv6_small_rec)
    ↓ Parse format: "MapNameX,Y" (comma/dot/period separated)
    ↓ Character correction: S→8, O→0, etc.
    ↓ Ghost prediction (quadrant + corner areas)
    ↓ Return: map, x, y, position_areas, corner_areas, annotated_image
```

### Trigger conditions (all must be met)

1. Task track detected (confidence > 0.8)
2. Zhong Kui detected (confidence > 0.8)
3. Yellow pixels >= 500 in crop region

## Important Files

### Backend services

- `services/template_matcher.py` - Yellow text extraction + multi-scale template matching
- `services/rapidocr_recognizer.py` - PP-OCRv6 with character correction
- `services/ghost_predictor.py` - Quadrant prediction logic

### Models

- `backend/models/combined_dict.txt` - 41-char dictionary for OCR (0-9 + punctuation + map keywords)
- `frontend/public/models/zhuagui/` - TensorFlow.js YOLO model (11.7MB, 480x480 input, 8 classes)

### Static pages

- `frontend/public/mhxy/static/keju.html` - Quiz with perceptual hash matching
- `frontend/public/ghost_monitor.html` - Ghost monitoring with YOLO detection
- `frontend/public/test_recognition.html` - OCR vs template matching comparison

## API Endpoints

### Game backend (8000)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ghost/capture` | POST | Combined OCR + template matching, returns both results |
| `/api/maps` | GET | Map list (12 maps) |
| `/api/templates` | GET | Template list |

### OCR backend (8001)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ocr/general` | POST | General OCR (PP-OCRv6) |
| `/api/hash-db/collect` | POST | Quiz hash crowd collection |

## Map Names

Standard: 傲来国, 宝象国, 长寿村, 大唐境外, 东海湾, 建邺城, 江南野外, 女儿村, 普陀山, 五庄观, 西梁女国, 朱紫国

OCR alias: 西凉女国 → 西梁女国

## Coordinate Format

OCR recognizes: `MapNameX,Y` or `MapNameX.Y` or `MapNameX。Y`

Examples:
- `宝象国48，128` → 宝象国 (48, 128)
- `江南野外85.54` → 江南野外 (85, 54)

## YOLO Classes

| ID | Name | Purpose |
|----|------|---------|
| 0 | 任务追踪 | Crop region anchor |
| 1 | 钟馗 | Trigger ghost mode |
| 2 | 黑无常 | Trigger ghost mode |
| 3 | 店小二 | Trigger treasure mode |
| 4-7 | Others | - |

## Troubleshooting

### OCR not working / 500 error

1. Check if OCR backend is running: `lsof -i :8001`
2. If not, start in Terminal: `cd backend && ./start_keju.sh`
3. Must use Python 3.9: `/usr/bin/python3 -c "import rapidocr; print('ok')"`

### Vite proxy 500 but backend OK

Check `frontend/vite.config.ts` proxy configuration.

### WebSocket errors on production

WebSocket connections fail through Cloudflare Tunnel. Vite HMR errors can be ignored in production.

## Production Deployment

Using Cloudflare Tunnel:
- Frontend: `https://mhxy.mhwk.cloud`
- Backend API: `https://api.mhwk.cloud`

Start tunnel: `cloudflared tunnel run mhxy-helper`