# 메이플랜드 버프 타이머 — 개발 스펙 문서

> 최종 수정: 2026-04-19
> 참고: [POLICY.md](./POLICY.md) (정책 체크리스트)
> 라이브: https://top6421.github.io/holy-buff-timer/
> 리포: https://github.com/top6421/holy-buff-timer

---

## 1. 프로젝트 개요

### 목적
메이플랜드(MapleStory Worlds)에서 **홀리심볼 버프** 잔여시간이 특정 초에 도달했을 때 **자동 알림**을 제공하는 웹 서비스.

### 핵심 동작 원리
1. 사용자가 **해상도 + 알림 시간**(예: 1600 - 25초) 선택 → 해당 시점의 버프 아이콘 스냅샷을 템플릿으로 로드
2. **화면 공유**(getDisplayMedia)로 게임 화면 캡처
3. 화면 우측 ROI 영역에서 **500ms 간격**으로 `cv.matchTemplate` 실행
4. 매칭 점수 ≥ 0.978 → **알림 사운드 재생** (3초 쿨다운)

### 참고 선례
- [kimdanjin.github.io/buff](https://kimdanjin.github.io/buff/) — 동일 원리, 본 프로젝트의 기반 참조
- [aprud.me](https://aprud.me) — 화면공유 기반 EXP 측정기

---

## 2. 정책 준수

상세: [POLICY.md](./POLICY.md)

- ✅ **화면공유 픽셀 분석만** 사용 (게임 클라이언트/메모리/패킷 접근 없음)
- ✅ **브라우저 로컬 처리**만 (외부 서버 전송 0건)
- ✅ **읽기 전용** (게임에 입력 전송 없음, 매크로 아님)
- ✅ 물리적 스톱워치와 동일 위상 — "측정·알림 전용, 자동화 아님"

---

## 3. 기술 스택

| 구성 | 용도 |
|---|---|
| **Vanilla JavaScript (IIFE 모듈 패턴)** | 프레임워크 없이 모듈화 |
| **getDisplayMedia API** | 화면 캡처 |
| **OpenCV.js 4.8.0** | 템플릿 매칭 (`TM_CCOEFF_NORMED`) |
| **Web Audio API** | 비프 알림 |
| **Notification API** | 브라우저 알림 |
| **LocalStorage** | 설정 저장/복원 |
| **`<audio>` 요소** | MP3/WAV 알림 사운드 재생 |

### 외부 서비스
- 없음 (100% 클라이언트 사이드)

### 배포
- GitHub Pages (https://top6421.github.io/holy-buff-timer/)

---

## 4. 탐지 알고리즘

### 4.1 흐름

```
[1] 사용자가 해상도 + 알림 시간 선택 → 템플릿 이미지 로드 + ROI 설정
[2] 화면 공유 시작 → 게임 창 캡처
[3] 500ms 간격으로:
    - 전체 프레임에서 ROI 영역(화면 우측) 크롭
    - cv.matchTemplate(roi, template, TM_CCOEFF_NORMED)
    - maxVal ≥ 0.978 → 알림 발동 (3초 쿨다운)
```

### 4.2 템플릿 매칭

| 항목 | 값 |
|---|---|
| 알고리즘 | `TM_CCOEFF_NORMED` |
| 임계값 | **0.978** (98% 일치) |
| 간격 | 500ms |
| 알림 쿨다운 | 3000ms |

### 4.3 ROI (탐색 영역)

화면 우측 끝에서 고정 크기로 크롭. 해상도별 사전 정의:

```
ROI.x = videoWidth - ROI.width   (우측 끝 기준)
ROI.y = 해상도별 고정값
ROI.width, ROI.height = 해상도별 고정값
```

| 해상도 | ROI 너비 | ROI 높이 | ROI Y좌표 |
|---|---|---|---|
| 1280×800/720 | 450 | 50 | 122 |
| 1600×1024/900 | 600 | 60 | 145 |
| 1920×1200/1080 | 700 | 73 | 165 |
| 맥북 레티나 | 800 | 140 | 300 |

### 4.4 성능

| 연산 | 시간 |
|---|---|
| ROI 크롭 + matchTemplate | ~5-10ms |
| 재사용 Canvas/Mat | 메모리 누수 방지 |
| OpenCV 초기 로드 | ~5-10초 (CDN) |

---

## 5. 템플릿 이미지

해상도별로 "특정 초수 남았을 때의 버프 아이콘 스크린샷"을 미리 준비.
매칭 시 해당 이미지가 화면에 보이면 알림 발동.

### 보유 템플릿

```
image/templates/
├── 1280/     15초, 20초, 30초
├── 1600/     7초, 10초, 15초, 20초, 25초, 30초
├── 1920/     15초, 20초, 25초, 30초
└── macbook/  25초
```

### 템플릿 추가 방법
1. 해당 해상도로 게임 실행
2. 원하는 초수 남았을 때 스크린샷 (버프 아이콘만 크롭, ~50-100px)
3. `image/templates/{해상도}/{초수}.png` 로 저장
4. `index.html`에 `<button class="time-btn" data-src="..." ...>` 추가

---

## 6. 사운드 시스템

### 알림 사운드 4종

| 파일 | 설명 |
|---|---|
| `sounds/alert.mp3` | 기본 알림 |
| `sounds/bell.wav` | 벨 (880+1320Hz) |
| `sounds/warning.wav` | 경고음 (440Hz 2연타) |
| `sounds/chime.wav` | 차임 (523+659+784Hz 화음) |

### 사용자 설정
- **사운드 선택**: 드롭다운
- **볼륨 조절**: 0~100% 슬라이더
- **테스트 버튼**: 선택한 사운드 미리 듣기
- 모든 설정 LocalStorage 자동 저장/복원

---

## 7. 모듈 구조

```
sim/
├── index.html
├── css/styles.css
├── js/
│   ├── app.js           # 메인 컨트롤러 (UI 이벤트, 모듈 통합)
│   ├── capture.js       # getDisplayMedia + 프레임 추출
│   ├── detector.js      # OpenCV 템플릿 매칭 + ROI
│   ├── notifier.js      # Web Audio / Notification / 플래시
│   ├── storage.js       # LocalStorage
│   └── timer.js         # 500ms 감지 루프
├── sounds/              # 알림 사운드 4종
├── image/templates/     # 해상도별 템플릿 이미지
├── POLICY.md
├── SPEC.md
└── README.md
```

### 모듈 공개 API

```js
Capture:   { on, startShare, stopShare, grabFrame, grabFrameCanvas,
             getVideoSize, getStream, isSharing }

Detector:  { init, loadTemplate, setROI, detect, isReady,
             getMatchThreshold, setMatchThreshold }

Timer:     { on, start, stop, isRunning }
           events: start, stop, matched, tick

Notifier:  { init, beep, notify, flash, alertExpiring }

Storage:   { save, load, saveROI, loadROI, clear }
```

---

## 8. UI / UX

### 페이지 구성 (상단→하단)

1. **헤더**: 제목 + 부제 + 버전
2. **사용 방법** (접이식): 3단계 안내 + 주의사항
3. **알림 시간 선택**: 해상도별 시간 버튼 그리드 (선택 시 초록 강조)
4. **사운드 설정**: 사운드 선택 + 볼륨 슬라이더 + 테스트
5. **ROI 위치 조정** (테스트용): Y좌표/높이/너비 수동 입력 + 적용 버튼
6. **화면 공유 및 탐지**: 공유/탐지 시작·중지 버튼 + 실행 상태 + 매칭 점수
7. **버프 영역 프리뷰**: ROI 영역만 실시간 Canvas 표시
8. **푸터**: 고지문

### 프리뷰
- `<video>` 숨김 (캡처 전용)
- `<canvas>` 에 ROI 영역만 실시간 `drawImage` (requestAnimationFrame)
- 사용자가 버프 아이콘이 프리뷰에 보이는지 확인 가능

### 설정 저장
LocalStorage에 자동 저장/복원:
- 선택된 템플릿 (src, name, ROI 값)
- 사운드 종류 + 볼륨

---

## 9. 파라미터 상수

### detector.js
```js
MATCH_THRESHOLD: 0.978       // 매칭 임계값
```

### timer.js
```js
DETECTION_INTERVAL_MS: 500   // 감지 주기
ALERT_COOLDOWN_MS: 3000      // 알림 후 쿨다운
```

---

## 10. 개발 단계

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | 화면 녹화 모듈 (디버깅용) | ✅ 완료 → 제거됨 |
| 2 | 자동 스케일 탐지 + OCR 카운트다운 | ✅ 완료 → 폐기 |
| 3 | **템플릿 이미지 매칭 방식 전환** | ✅ 완료 (현재) |
| 4 | 사운드 설정 (4종 + 볼륨) | ✅ 완료 |
| 5 | 맥북 레티나 해상도 지원 | ✅ 완료 |
| 6 | GitHub Pages 배포 | ✅ 완료 |
| 7 | 추가 해상도/초수 템플릿 확장 | 진행 중 |
| 8 | 정식 공개 (랜딩 페이지, 정책 문의) | 예정 |

---

## 11. 폐기된 기능 (참고)

초기 버전에서 시도했으나 **템플릿 매칭 방식이 더 단순·정확**하여 폐기:

- **OCR 기반 카운트다운**: Tesseract.js로 아이콘 숫자 읽기 → 인식률 불안정, 복잡한 전처리 필요
- **밝기 기반 갱신 감지**: 아이콘 회색 오버레이 진행도 측정 → 불필요 (템플릿 방식은 갱신 감지 자체가 불필요)
- **자동 스케일 탐지**: 17단계 스케일 스캔 → 불필요 (해상도별 고정 템플릿)
- **PIP(Picture-in-Picture) 창**: Document PIP API → 삭제 (게임 전체화면에서 실용성 부족)
- **수동 갱신 버튼**: Space 키 단축키 → 삭제 (템플릿 방식에서 불필요)

---

## 12. 미해결 / 향후 작업

- [ ] 추가 해상도 템플릿 (2560×1440 등)
- [ ] 맥북 추가 초수 템플릿 (7, 10, 15, 20, 30초)
- [ ] ROI 조정 UI 정식 통합 또는 제거 (현재 테스트용)
- [ ] 정식 공개 전 메이플랜드 고객센터 문의
- [ ] 랜딩 페이지 + FAQ + 이용약관
- [ ] 커스텀 도메인

---

## 13. 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-04-14 | 프로젝트 시작, 화면 녹화 모듈, OCR 탐지 엔진 |
| 2026-04-15 | OCR 기반 카운트다운, HSV 전처리, GitHub Pages 배포 |
| 2026-04-18 | **템플릿 매칭 방식으로 전면 전환** (kimdanjin 참조) |
| 2026-04-18 | PIP 제거, 사운드 설정 추가, 시간 버튼 UI |
| 2026-04-18 | 맥북 레티나 해상도 지원, ROI 테스트 UI |
| 2026-04-19 | 매칭 점수 실시간 표시, 문서 최신화 |
