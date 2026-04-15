# 메이플랜드 버프 타이머 — 개발 스펙 문서

> 최종 수정: 2026-04-14
> 참고: [POLICY.md](./POLICY.md) (정책 체크리스트)
> 라이브: https://top6421.github.io/holy-buff-timer/

---

## 1. 프로젝트 개요

### 목적
메이플랜드(MapleStory Worlds 기반)에서 **홀리심볼 버프(2분 지속)**의 잔여시간을 실시간 감지하고, 만료 전 알림(기본 5초 전, 1~60초 사용자 설정)을 제공하는 웹 서비스.

### 해결하려는 문제
- 버프 지속시간 체크 부담 (항상 시간 확인 어려움)
- 만료 전 갱신해야 효율 유지 (놓치면 경험치 손실)
- 여러 버프 갱신으로 **홀리심볼 아이콘 위치가 수시로 이동**

### 참고 선례
[aprud.me](https://aprud.me) — 동일 원리로 EXP/메소 측정기 운영 중, 제재 사례 0건

---

## 2. 정책 준수 (필수)

상세: [POLICY.md](./POLICY.md)

### 절대 지켜야 할 원칙
- ✅ **화면공유(getDisplayMedia) 픽셀 분석만** 사용
- ✅ **브라우저 로컬 처리**만, 외부 서버 전송 금지
- ✅ **읽기 전용** — 게임 클라이언트/메모리/패킷 접근 금지
- ❌ 키보드/마우스 자동 입력 금지 (**매크로성 자동화는 확실한 제재**)
- ❌ 게임 창 위 오버레이 직접 렌더링 금지 (PIP 별도 창은 OK)

---

## 3. 기술 스택

### 프론트엔드 (Vanilla JS + CDN 라이브러리)
| 구성 | 용도 |
|---|---|
| **Vanilla JavaScript (IIFE 모듈 패턴)** | 프레임워크 없이 모듈화 |
| **getDisplayMedia API** | 화면 캡처 |
| **MediaRecorder API** | 녹화 (디버깅 도구) |
| **OpenCV.js 4.x** | 템플릿 매칭 (아이콘 위치 탐지) |
| **Tesseract.js v5** | 잔여시간 숫자 OCR |
| **Web Audio API** | 만료 임박 비프 알림 |
| **Notification API** | 브라우저 알림 |
| **LocalStorage** | ROI 좌표·알림시간 설정 저장 |

### 외부 서비스
- 없음 (모든 처리 클라이언트 로컬)

### 배포
- GitHub Pages (https://top6421.github.io/holy-buff-timer/)

---

## 4. 탐지 알고리즘

### 4.1 3단계 하이브리드 검출

```
[1] 초기 캘리브레이션 (전체 화면 스캔, 1초 주기)
      ↓ 아이콘 발견 (3회 연속)
[2] ROI 자동 설정 (화면 우측 끝 고정, X 크게 / Y 타이트)
      ↓
[3] ROI 내 템플릿 매칭 (1초 주기, 고정 스케일)
      ↓
[4] 매칭점수·아이콘 밝기로 갱신 감지
      ↓
[5] 잔여 ≤ 60초 구간에서 OCR로 카운트다운 동기화
      ↓
[6] 잔여 ≤ 알림시간 → 알림 발동
```

### 4.2 템플릿 매칭 파라미터

| 항목 | 값 | 근거 |
|---|---|---|
| **템플릿 이미지** | `image/reference/icon.png` (32×32 RGBA) | 실제 게임 에셋, 영상 간 일반화 우수 |
| **매칭 알고리즘** | `TM_CCOEFF_NORMED` | OpenCV 표준 정규화 상관 |
| **매칭 임계값** | **0.45** | 회색 진행 시 최저 0.547 + 여유 |
| **초기 스캔 스케일 범위** | **0.5 ~ 4.5 (0.25 step, 17단계)** | DPI/해상도 차이 자동 적응 (비레티나 ~레티나) |
| **TRACKING 스케일** | 초기 감지된 스케일 고정 | ROI 스캔 속도 최적화 |
| **템플릿 알파 합성** | 흰색 배경으로 플래튼 | 게임 아이콘 프레임이 흰색 |
| **최소 유효 템플릿 폭** | 20px | 20px 미만은 매칭 품질 급락 |

### 4.3 ROI 자동 설정 — **우측 끝 고정 전략**

버프 아이콘 UI는 **화면 오른쪽에서 왼쪽으로 쌓이는** 구조. 새 버프가 추가되면 홀리심볼은 좌측으로 밀리지만, **우측 끝은 항상 화면 우측**이다. 따라서 ROI를 우측 끝 기준으로 고정하면 버프 개수가 바뀌어도 ROI 재설정이 불필요.

```js
// X축: 화면 우측 끝에서 고정 오프셋, 좌로 프레임 너비의 35% 확장
const x1 = frameWidth - ROI_RIGHT_PAD_PX;               // 10px 여유
const x0 = Math.max(0, x1 - frameWidth * ROI_WIDTH_RATIO); // 35%

// Y축: 감지된 아이콘 위치 기준 타이트 (드리프트만 허용)
const y0 = max(0, detectedY - ROI_PAD_Y_PX);
const y1 = min(H, detectedY + iconH + ROI_PAD_Y_PX);
```

| 상수 | 값 | 비고 |
|---|---|---|
| `ROI_WIDTH_RATIO` | **0.35** | 기존 0.55에서 축소 (버프바는 우측 협소 영역에만 존재) |
| `ROI_RIGHT_PAD_PX` | 10 | 화면 우측 끝 여유 |
| `ROI_PAD_Y_PX` | 20 | Y축 상하 여유 |

### 4.4 아이콘 밝기 측정

카운트다운 진행에 따라 아이콘 위에 회색 오버레이가 점진적으로 깔림 → 평균 밝기 감소.

```js
// 표준 luminance (0.299R + 0.587G + 0.114B)
// 2픽셀 step 샘플링으로 성능 확보
measureBrightness(imageData, loc, size) → [0, 255]
```

### 4.5 성능 측정값

| 연산 | 시간 |
|---|---|
| 초기 전체 스캔 (17개 스케일) | ~4000ms (1회) |
| ROI 스캔 (고정 스케일) | ~7ms |
| 밝기 측정 (2px step) | <1ms |
| OCR (Tesseract Worker 재사용) | ~200ms |
| 전체 루프 주기 | 1초 |

---

## 5. OCR 기반 카운트다운

### 5.1 게임 UI 관찰

- 버프 아이콘은 **잔여 < 60초**일 때만 **주황·노랑·빨강** 카운트다운 숫자를 아이콘 위에 표시.
- 60초 초과 구간에는 숫자 없음 (단, 작은 흰색 "1"은 아이템 스택 표기 — 타이머 아님, 흰색이라 색상 마스크로 자동 배제됨).
- 따라서 내부 상태는 **2단계**:
  1. **TRACKING · 대기 중** — 아이콘은 감지됐으나 OCR이 유효 숫자(1~59)를 아직 못 읽음
  2. **TRACKING · 카운트다운** — OCR 동기화 후 내부 시계로 카운트다운

### 5.2 OCR 영역

아이콘 좌하단 55%×55% 영역을 크롭:

```js
sx = loc.x
sy = loc.y + size.h * 0.45
sw = size.w * 0.55
sh = size.h * 0.55
```

### 5.3 전처리 파이프라인 (`OCR.preprocForTimerOcr`)

1. **HSV 색상 마스크** — 카운트다운 색만 남기고 나머지를 흰색으로
   - 빨강/주황: `H ≤ 25 || H ≥ 160`, `S ≥ 100`, `V ≥ 100`
   - 노랑: `15 ≤ H ≤ 35`, `S ≥ 100`, `V ≥ 100`
   - H 범위는 OpenCV 관례(0~179)
2. **3× 업스케일** (`imageSmoothingQuality: 'high'`, cubic)
3. **20px 흰색 패딩** (Tesseract 경계 여유)
4. **Tesseract 파라미터**:
   - PSM 8 (`SINGLE_WORD`)
   - `classify_bln_numeric_mode=1`
   - `tessedit_char_whitelist='0123456789'`

### 5.4 검증 성능
- 카운트다운 표시 구간: **5/5 완벽 인식**
- 미표시 구간(60초 초과): **10/10 공백 반환** (오인식 0)

### 5.5 동기화 로직 (`Timer.tryOcrRead`)

```
숫자 n 읽음 (1 ≤ n ≤ 59, confidence ≥ 30)
  ↓
if !ocrSynced:
  if n ≥ OCR_SYNC_FAST_MIN (50):
    → 1회 읽어도 즉시 sync (50~59 구간은 오탐 가능성 매우 낮음)
  else:
    → 연속 단조 감소 2회 확인 후 sync
  sync 완료 시:
    remainingSec = n
    startTime = now - (BUFF_DURATION - n) * 1000
else:  # 동기화 이후 보정
  diff = n - remainingSec
  if diff ≥ OCR_REFRESH_JUMP_MIN (+10): 갱신으로 간주
  elif -4 ≤ diff ≤ +1: 시계 보정
  else: 무시
```

---

## 6. 갱신 감지 (3중 지표)

매 TRACKING 틱마다 아래 지표 중 **하나라도** 만족 시 갱신으로 간주하고 타이머 리셋 + OCR 재동기화 대기 상태로 전환.

| # | 지표 | 임계 | 상수 |
|---|---|---|---|
| 1 | **매칭 점수 스파이크** — 최근 평균 대비 상승 | +0.06 이상 | `REFRESH_SCORE_DELTA` |
| 2 | **아이콘 평균 밝기 스파이크** — 최근 평균 대비 상승 | +10 이상 | `REFRESH_BRIGHTNESS_DELTA` |
| 3 | **밝기 초기값 복귀** — 현재/초기 비율 | ≥ 0.92 & 직전 평균은 낮은 상태 | `REFRESH_BRIGHTNESS_RATIO` |
| 4 | **OCR 값 급등** — 동기화 후 보정용 | +10초 이상 | `OCR_REFRESH_JUMP_MIN` |

### 오발동 방지 가드
- 최소 경과 시간: **3초** (`REFRESH_MIN_ELAPSED_SEC`)
- 쿨다운: **3초** (`REFRESH_COOLDOWN_MS`)
- 스코어/밝기 버퍼: 최근 3틱 평균 기준 (`SCORE_BUFFER_SIZE`, `BRIGHTNESS_BUFFER_SIZE`)
- `REFRESH_DEBUG=true` 시 매 틱 로그 출력

### 백업: 수동 갱신
자동 감지가 놓칠 경우를 대비해 `🔄 갱신` 버튼 + **Space 단축키** 제공 (`Timer.manualRefresh()`).

---

## 7. 모듈 구조

```
sim/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js           # 메인 컨트롤러 (UI 이벤트 와이어링)
│   ├── capture.js       # getDisplayMedia + 프레임 추출
│   ├── detector.js      # OpenCV 템플릿매칭 + ROI + 밝기 측정
│   ├── ocr.js           # Tesseract Worker + HSV 전처리
│   ├── timer.js         # 상태 머신 + 카운트다운 + 갱신 감지
│   ├── overlay.js       # 프리뷰 위 아이콘/ROI 시각화
│   ├── notifier.js      # Web Audio / Notification / 플래시 / 진동
│   ├── storage.js       # LocalStorage (ROI, 알림시간)
│   └── recorder.js      # 디버깅용 녹화 도구
├── image/
│   ├── reference/icon.png      # 32×32 RGBA 템플릿
│   └── labeled/                # 15개 라벨 이미지 (OCR/시각 검증용)
├── recording/           # 테스트 영상 (git 제외)
├── POLICY.md
├── SPEC.md
└── README.md
```

### 모듈 공개 API 요약

```js
Capture:   { on, startShare, stopShare, grabFrame, grabFrameCanvas,
             getVideoSize, getStream, isSharing }

Detector:  { init, scanFullFrame, scanROI, computeROI,
             measureBrightness, getConfig, isReady }

OCR:       { init, readNumber, terminate, isReady, preprocForTimerOcr }

Timer:     { on, start, stop, rescan, manualRefresh,
             setAlertThreshold, getConfig, getStatus }
           events: stateChange, tick, detect, sync, alert, expired, refreshed

Overlay:   { init, setEnabled, isEnabled, update, clear }

Notifier:  { init, beep, notify, flash, alertExpiring }

Storage:   { save, load, saveROI, loadROI, clear }
```

---

## 8. 상태 머신

```
IDLE
  ↓ "화면 공유 시작" → "탐지 시작"
SCANNING                                (전체 화면 템플릿매칭)
  ↓ 3회 연속 감지 (CONSECUTIVE_DETECT_REQUIRED)
TRACKING · 대기 중                      (OCR 동기화 전, 시간란 "대기 중...")
  ↓ OCR이 50~59 1회 읽음 (FAST)
  ↓ 또는 1~49 구간 연속 단조감소 2회
TRACKING · 카운트다운                   (내부 시계로 초 단위 감소)
  │ ├─ 매 틱 OCR 보정 (±1초 수준)
  │ ├─ 갱신 감지 시 → 대기 중으로 복귀
  │ ├─ ROI 내 매칭 10회 연속 실패 → SCANNING 복귀
  │ └─ 잔여 ≤ 알림시간 & 미알림
  ↓
ALERTING                                (비프·알림·플래시·진동)
  ↓ 즉시 복귀
TRACKING · 카운트다운
  ↓ remainingSec = 0
expired 이벤트 → TRACKING 유지 (갱신 대기)
```

---

## 9. UI / UX

### 레이아웃 (실제 구현)

```
┌─────────────────────────────────────────┐
│ 🔔 홀리심볼 버프 타이머                  │
├─────────────────────────────────────────┤
│ [🖥️ 화면 공유 시작] [⏹️ 공유 중지]        │
│ [🔍 탐지 시작]     [⏸️ 탐지 중지]         │
│ [🔄 갱신 (Space)]  [👁️ 영역 표시]         │
│                                         │
│ 알림 시간(초 전): [ 5 ] (1~60)           │
├─────────────────────────────────────────┤
│ 공유 OFF | 탐지 IDLE | 점수 — | 잔여 --:-- │
│ ████████████░░░░░ (progress)            │
├─────────────────────────────────────────┤
│ 📺 프리뷰                                │
│ [video + overlayCanvas]                 │
├─────────────────────────────────────────┤
│ ▶ 🎬 녹화 도구 (디버깅용, details)        │
├─────────────────────────────────────────┤
│ [📜 정책 보기] · 측정·알림 전용, 자동화 아님│
└─────────────────────────────────────────┘
```

### 주요 DOM 요소
| ID | 역할 |
|---|---|
| `#startShareBtn` / `#stopShareBtn` | 화면 공유 제어 |
| `#startDetectBtn` / `#stopDetectBtn` | 탐지 시작/정지 |
| `#refreshBtn` | 수동 갱신 (자동 감지 실패 시 백업, 단축키 Space) |
| `#toggleOverlayBtn` | 영역 시각화 ON/OFF |
| `#alertSeconds` | 알림 시간(초 전) 입력 1~60 |
| `#shareStatus` / `#detectStatus` | 상태 표시 |
| `#matchScore` / `#remainingTime` | 매칭 점수·잔여시간 |
| `#progressBar` | 잔여시간 바 (high/mid/low 단계 색상) |
| `#preview` / `#overlayCanvas` | 프리뷰 비디오 + 오버레이 캔버스 |
| `#flashOverlay` | 전체 화면 플래시 레이어 |
| `#analysisCanvas` | 숨김, 프레임 분석용 |

### Overlay 모듈 (신규)
`<video>` 위에 `<canvas>`를 겹쳐 렌더. `object-fit: contain` 매핑 보정 포함:
- **초록 실선 박스** — 감지된 홀리심볼 아이콘 (`#10b981`)
- **노란 점선 박스** — ROI 탐색 영역 + 반투명 fill (`rgba(250,204,21,...)`)
- 라벨 텍스트로 "홀리심볼" / "ROI (탐색 영역)" 표시
- `requestAnimationFrame`으로 그리기 스케줄

### "대기 중..." 표시
OCR 동기화 전에는 잔여시간 란에 `대기 중...`, 프로그레스 바는 100%로 표시. OCR이 유효 숫자를 잡으면 실제 값으로 전환.

### 알림 방식 (동시 발동, `Notifier.alertExpiring`)
1. **Web Audio**: 880Hz 비프 × 3회 (200ms, 80ms gap)
2. **Notification API**: "홀리심볼 만료 임박 — N초 남음 · 갱신하세요"
3. **화면 플래시**: `#flashOverlay` 빨간색 점멸 3회
4. **진동**: 지원 시 `navigator.vibrate([200,100,200])`

---

## 10. 파라미터 상수 (현재값)

### `timer.js` CONFIG
```js
SCAN_INTERVAL_MS: 1000
CONSECUTIVE_DETECT_REQUIRED: 3
CONSECUTIVE_MISS_RESCAN: 10
ALERT_THRESHOLD_SECONDS: 5        // 사용자 설정 1~60
BUFF_DURATION_SECONDS: 120

REFRESH_SCORE_DELTA: 0.06
REFRESH_BRIGHTNESS_DELTA: 10
REFRESH_BRIGHTNESS_RATIO: 0.92
REFRESH_MIN_ELAPSED_SEC: 3
REFRESH_COOLDOWN_MS: 3000
REFRESH_DEBUG: true

SCORE_BUFFER_SIZE: 3
BRIGHTNESS_BUFFER_SIZE: 3

OCR_MIN_CONFIDENCE: 30            // Tesseract.js는 낮게 반환하는 경향
OCR_SYNC_CONFIRM: 2               // 일반 구간 2회 단조감소 확인
OCR_SYNC_FAST_MIN: 50             // ≥50은 1회로 즉시 sync
OCR_MAX_DECREMENT: 10             // OCR 지연 흡수
OCR_REFRESH_JUMP_MIN: 10          // +10초 이상 → 갱신 간주
```

### `detector.js` CONFIG
```js
MATCH_THRESHOLD: 0.45
INIT_SCAN_SCALES: [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5,
                   2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5]
ROI_WIDTH_RATIO: 0.35
ROI_RIGHT_PAD_PX: 10
ROI_PAD_Y_PX: 20
TEMPLATE_PATH: "image/reference/icon.png"
```

### `ocr.js` (Tesseract 파라미터)
```
tessedit_pageseg_mode   = PSM.SINGLE_WORD (8)
classify_bln_numeric_mode = 1
tessedit_char_whitelist = "0123456789"
```

### `storage.js`
- 키: `holy_buff_timer`
- 필드: `{ roi, alertSeconds }`

---

## 11. 개발 단계

- **Phase 1 (완료)**: 화면 녹화 — getDisplayMedia + MediaRecorder, 테스트 영상 수집
- **Phase 2 (완료)**: 탐지 엔진 — OpenCV.js 템플릿 매칭 + ROI 우측 고정 + 밝기 측정
- **Phase 3 (완료)**: OCR 기반 카운트다운 — HSV 전처리 파이프라인 + 2단계 동기화 로직
- **Phase 4 (완료)**: 알림·갱신 감지·UI 개선 — 3중 갱신 지표, Overlay 시각화, 알림시간 설정, 수동 갱신
- **Phase 5 (완료)**: 배포 — GitHub Pages (https://top6421.github.io/holy-buff-timer/)
- **Phase 6 (현재)**: 안정화·튜닝 — 실전 케이스 수집, 임계값 최적화
- **Phase 7 (예정)**: 정식 공개 전 정책 문의 + 랜딩 페이지 정비

---

## 12. 테스트 자산

### 녹화 영상 (`recording/` — git ignore, 로컬 보관)
| 파일 | 용도 |
|---|---|
| `holysimbol_only_1.webm` | 단일 버프 풀 사이클 |
| `holysimbol_only2.webm` | 단일 버프 풀 사이클 (2번째 세션) |
| `multiple_buff.webm` | 여러 버프 혼재 |
| `buff-capture-2026-04-14T18-11-35.webm` | 실전 세션 |
| `buff-capture-2026-04-14T18-57-18.webm` | 실전 세션 |

### 이미지
| 경로 | 용도 |
|---|---|
| `image/reference/icon.png` | 32×32 RGBA 메인 템플릿 |
| `image/labeled/` | 15개 라벨 이미지 (OCR/시각 검증) |

---

## 13. 미해결 / 향후 검증

- [ ] **해상도 적응** — 비레티나 2042×1148 확인 완료, **1920×1080 / 2560×1440 추가 검증 필요**
- [ ] **OCR 장시간 안정성** — 세션 30분 이상 연속 동작 시 메모리/정확도 추이
- [ ] **배경 복잡도** — 전투 이펙트 많은 상황에서 매칭 안정성 재검증
- [ ] **다른 버프 템플릿 확장성** — 블레스, 샤프아이즈 등 동시 모니터링 구조 설계
- [ ] **정책 공식 문의** — 메이플랜드 고객센터 답변 확보 (Phase 7)

---

## 14. 변경 이력

- **2026-04-14**: OCR 카운트다운 파이프라인·3중 갱신 감지·Overlay 모듈·ROI 우측 끝 고정 전략 반영. GitHub Pages 배포.
- **2026-04-15** (초안): 초기 스펙 작성 (Phase 1~2 기준).
