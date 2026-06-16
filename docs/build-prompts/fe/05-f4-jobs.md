# 05 · f4-jobs — 5단계(제출 및 실시간 모니터링)  ※ 클러스터 의존 → MOCK MODE 필수

> 사용법: `fe/01-foundation.md` 완료 후, 새/같은 세션에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 **f4-jobs** 기능(5단계: SGE 제출 + 8초 폴링 실시간 모니터링)을 `frontend`에 구현한다. 실제 제출/모니터링은 **Faraday SGE 클러스터가 필요**하므로, 로컬 시뮬레이션을 위해 **MOCK MODE를 1순위로** 만들고 실제 호출은 그 위에 얹는다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f4-jobs/api.md` — `POST /submit-job`, `GET /job-live-status/{job_key}?lang`, `POST /job-stop`, `GET /download-job/{job_name}`의 계약.
- `docs/contracts/data-models.md` — `SubmitRequest`, `SubmitJobResponse`, `JobStatus`, `StepHistory`, `MultiMetadata`의 정확한 필드(로그/에너지/SCF/TDDFT/서브잡 구조).
- `docs/design-system.md` §4.2(5단계: 상태바 + 로그 터미널 + SCF 수렴 차트 + STOP)·§4.4(우측 라이브 미러).

### 만들 것 (`app/(wizard)/step-5`)
1. **제출**: [SGE 제출] → `POST /submit-job`(body=store의 files/atom_info/steps/옵션). 응답 `SubmitJobResponse`(directory/sub_jobs) 저장 후 모니터링 대시보드로 전환. **다중-CIF면** f3의 구조별 `.inp`가 **서브잡 N개**(`sub_jobs[]`)로 제출되며, 대시보드는 서브잡 전체를 한눈에 보여준다.
2. **실시간 모니터링**: 공유 훅 `usePolling`으로 `GET /job-live-status/{job_key}?lang=ko`를 **8초 주기** 폴링. 표시:
   - 상태바: 단계 n/m·SCF 반복·경과·현재 에너지·**STOP**(→ `POST /job-stop`).
   - **LogTerminal**(다크): `JobStatus.logs` tail, 자동 스크롤.
   - **ConvergenceChart**: **`step_histories` 기준 스텝별로 분리** — 스텝 탭(또는 스텝별 개별 차트)으로 각 스텝의 SCF/에너지 수렴(로그축)을 따로 그린다. 여러 스텝을 한 차트에 합치지 말 것.
   - TDDFT 여기상태 그리드(해당 시). **다중-CIF면 서브잡 탭**으로 서브잡(=구조)별 상태/로그/수렴 차트를 전환(서브잡 안에서 다시 스텝별 차트).
   - 우측 SummaryPanel → **라이브 미러**(진행/SCF/로그 요약). 종료 상태(`all_finished`/`Success`/`error`/`aborted`)에서 폴링 중단.
3. **다운로드**: 완료 후 `GET /download-job/{job_name}`(blob → .tar.gz). [다음] → step-6.

### ★ MOCK MODE (클러스터 없이 끝까지 시연)
`NEXT_PUBLIC_MOCK === "1"`이면:
- `/submit-job`을 가짜 `SubmitJobResponse`로 즉시 성공 처리.
- `/job-live-status`를 **클라이언트 타이머 기반 가짜 스트림**으로 대체: `data-models.md`의 `JobStatus`/`StepHistory` 형태를 따라 SCF가 점진 수렴(ΔE 1e-2→1e-6), 로그 줄이 쌓이고, 단계가 진행되다 `all_finished`로 종료. **`step_histories`를 스텝마다 따로 채워** 스텝별 차트가 각각 그려지게 하라. (실제 폴링 코드 경로와 동일한 렌더가 목 데이터로 돌아가게 하라.)
- **다중-CIF 목**: `sub_jobs[]`를 2개 이상 두고 서브잡별로 위 스트림을 돌려, 서브잡 탭 전환이 끝까지 동작하게 하라.
- 미러/차트/터미널이 이 목 스트림으로 끝까지 움직여야 함.

### 완료 정의 (DoD)
- [ ] (MOCK) 제출 → 8초(목은 더 짧게) 폴링 → 로그·SCF 차트·진행·STOP·완료까지 전체 흐름이 끝까지 동작.
- [ ] 수렴 차트가 `step_histories` 기준 **스텝별로 분리**되어(스텝 탭/개별 차트) 그려진다.
- [ ] 다중-CIF면 서브잡 N개가 서브잡 탭으로 전환되고, 각 서브잡 안에서 스텝별 차트가 동작.
- [ ] 폴링 훅이 종료 상태에서 정확히 멈추고 setInterval 누수 없음(언마운트 정리).
- [ ] 실제 백엔드+클러스터가 있으면 `NEXT_PUBLIC_MOCK` 끄고 동일 UI가 실제 `/job-live-status`로 동작.
- [ ] 데이터 모양이 `JobStatus`/`SubmitJobResponse` 계약과 일치, 디자인 일치.
