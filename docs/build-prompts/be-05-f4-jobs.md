# be-05 · f4-jobs 백엔드 (🔴 MOCK — SGE 없음)

> `be-01-foundation.md` 완료 후 실행.

---

## 프롬프트

너는 백엔드 **f4-jobs** 기능을 from-scratch로 구현한다. 실제 SGE 클러스터가 없으므로 **가짜 job 스트림(MOCK)** 으로 제출/모니터링을 시뮬레이션한다(데이터 모양은 계약 그대로라 reference 이식 시 그대로 교체 가능).

### 먼저 읽어라
- `docs/features/f4-jobs/api.md` — `POST /submit-job`, `GET /job-live-status/{job_key}`, `POST /job-stop`, `GET /download-job/{job_name}`.
- `docs/contracts/data-models.md` — `SubmitRequest`/`SubmitJobResponse`/`JobStatus`/`StepHistory`.
- `docs/build-prompts/MVP-SCOPE.md`(🔴 MOCK).

### 구현 (`backend/app/features/jobs/` + `app/shared/jobs_mock.py`)
- **shared/jobs_mock.py**: 인메모리 job 저장소 + 가짜 진행 엔진. job 생성 시 SCF 수렴 시퀀스를 시간축으로 시뮬(ΔE 1e-2→1e-6, 단계 n/m 진행, 로그 줄 누적, 종료 시 `all_finished`). `JobStatus`(status/job_id/active_step/energy_history/logs/step_histories/message) 형태로 노출.
- **router.py**:
  - `POST /submit-job` → `SubmitJobResponse{status, directory, is_multi, sub_jobs[]}` 생성 후 백그라운드로 가짜 진행 시작.
  - `GET /job-live-status/{job_key}?lang=ko` → 현재 `JobStatus`(폴링할 때마다 진행). 종료 상태에서 안정.
  - `POST /job-stop` → 해당 job `aborted`.
  - `GET /download-job/{job_name}` → 더미 .tar.gz(또는 501).

### 완료 정의 (DoD)
- [ ] 제출 → 폴링(`/job-live-status`)로 SCF 수렴·로그·단계 진행이 흐르다 완료까지 = 계약 `JobStatus` 형태.
- [ ] STOP이 상태를 aborted로. 프런트 모니터 화면이 이 스트림으로 끝까지 동작.
- [ ] (명시) 실제 SGE 제출은 MVP 밖 — reference 허용 시 `orchestrator.py` 이식으로 교체.
