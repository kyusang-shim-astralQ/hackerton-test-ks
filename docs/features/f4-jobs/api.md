# 작업 제출 및 모니터링 (Job Submission & Monitoring) — `f4-jobs`

## 구현 위치 (폴더 구조)

이 기능은 `app/features/jobs/` 아래에 구현된다: HTTP 라우트는 `router.py`, 오케스트레이션/제출/모니터링 로직은 `service.py`(모듈-레벨 싱글톤), 기능 전용 요청 모델(`SubmitRequest`/`FileItem`)은 `schemas.py`에 둔다. cross-feature 모델(`AtomInfo`, `PlanStep`, `GeneratedFile`, `JobStatus`, `StepHistory` 등)은 `app/schemas/common.py`에 있다. SGE(`qsub`/`qstat`/`qdel`) 래퍼는 `app/core/sge.py`, 공유 엔진(`self_healing`, 옵션 파서 `app/shared/options.py`, 물리 패턴 `app/shared/physics_patterns.py`, 스키마 거버넌스 `app/shared/schema_engine.py`)은 `app/shared/*` 에 있고, 라우터 등록/미들웨어/정적 서빙 부트스트랩은 `app/main.py`가 담당한다.

> **한 줄 책임**: 생성된 `.inp`(또는 자동 생성된 `.inp`)와 `atom_info`/`steps`/DFT 파라미터를 받아 SGE(`qsub`)에 작업 스위트를 제출하고, `qstat` 폴링으로 실시간 상태를 모니터링하며, 실패 시 `self_healing`으로 자동 재시도하고, 단계 간 좌표를 체이닝한다. 다중구조 제출 시 `multi_metadata.json`을 기록하며, 단일/다중 라이브 상태와 작업 중단/다운로드를 제공한다.

> **MVP 실제 실행(SSH/SGE)**: 백엔드는 로컬에서 돌고 **`paramiko`로 클러스터(`.env`의 `CLUSTER_*`)에 SSH/SFTP 접속**해 `.inp`+`run.sh` 업로드 → `qsub` → `qstat` 폴링 → 결과 회수한다(`app/core/sge.py`). 아래 "외부 의존성"의 직접 `subprocess(qsub)` 서술은 **레거시(클러스터 내부 실행) 기준**이며, **엔드포인트·데이터 계약은 동일**하다. `USE_SGE=0`/연결 실패 시 목 스트림 폴백. 실패 시 **경량 AI 자가치유**(진단→`.inp` 수정→재시도 MAX3, `docs/prompts/healing-prompt.md`)는 **범위 안**; 34MB `schema_engine`·지식베이스 학습만 범위 밖.

| 항목 | 내용 |
|---|---|
| **담당 모듈** | `app/features/jobs/service.py` (모듈-레벨 싱글톤 `orchestrator = CP2KOrchestrator()`) |
| **라우터** | `app/features/jobs/router.py`의 4개 라우트가 `orchestrator` 싱글톤을 호출 (제출은 `BackgroundTask`) |
| **소유 범위** | `simulations/{job}/` 디렉토리 트리(step 디렉토리, `.inp`/`.sh`/`.out` 산출물), `backend/job_status.json`(상태 영속화), `multi_metadata.json`(다중구조 메타), `simulation_completed.flag` |
| **소유하지 않는 것** | `.inp` 렌더링 로직 자체(=`app/features/inp/service.py`의 `build_full_inp` 공유), 치유 처방 로직(=`app/shared/self_healing.py` 공유), 리포트 생성(=`f5-report`가 디스크 산출물만 직접 읽음) |

핵심 흐름:
```
[f3-inp: GeneratedFile[]]  또는  [files=None → 자동생성]
        │
        ▼  POST /submit-job (SubmitRequest)
  orchestrator.start_job_suite(...)  ← BackgroundTask, 반환값 없음
        │  _reindex_active_steps → job_status_db[job_key] = {status:'Running'}
        ▼  _submit_step(step_idx=1) → app/features/inp/service.py build_full_inp → app/core/sge.py SGE_TEMPLATE → qsub
  데몬 스레드: _monitor_and_chain (qstat 폴링)
        │  실패 → app/shared/self_healing.py diagnose/heal/heal_with_ai → 재시도(retry_count≤3)
        │  성공 → 좌표 체이닝(*-pos-1.xyz) → 다음 step
        ▼
  job_status.json (영속) ──GET /job-live-status──▶ 프런트 실시간 그래프/로그
  simulations/{job}/*   ──────────────────────────▶ f5-report (디스크 직접 소비)
```

---

## HTTP API 명세

전체 기준 경로(base): FastAPI 앱 루트. 인증/헤더 요구 사항 없음(CORS `*`). 요청 본문은 모두 `application/json`(단, 파일 다운로드는 GET).

> **공통 에러 규약**: 라우트 핸들러는 예외 발생 시 `HTTPException(status_code=500, detail="...")`로 응답한다. Pydantic 검증 실패는 `422`(커스텀 핸들러가 `{"detail": [...]}` 반환). 본 기능의 `/submit-job`은 검증 모델 `SubmitRequest`를 사용하고, `/job-stop`은 raw `Dict`를 받는다.

---

### 1) `POST /submit-job` — 작업 스위트 제출

생성된 `.inp`(`files`) 또는 자동 생성으로 SGE에 작업을 제출한다. `multi_atom_info`의 길이가 2 이상이면 **다중구조 병렬 제출** 분기로 동작한다. 제출 자체는 즉시 반환하고 실제 `qsub`는 `BackgroundTask`에서 수행된다(비동기 fire-and-forget).

**요청 본문 (`SubmitRequest`)**

> 주의: 본 모델의 DFT 기본값은 다른 기능의 모델과 **다르다**(`cutoff=400.0`, `rel_cutoff=50.0`, `functional='PBE'`, `basis_set='DZVP-MOLOPT-GTH'`, `property='energy'`).

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|:--:|---|---|
| `files` | `List[GeneratedFile] \| null` | N | `null` | 제출할 `.inp` 파일 목록(= `FileItem`). `null`이면 오케스트레이터가 자동 생성. 내부적으로 `{filename: content}` dict로 변환되어 `provided_files`로 전달 |
| `atom_info` | `AtomInfo` | **Y** | — | 단일 구조 정보. **소비 계약** (data-models.md `AtomInfo`) |
| `steps` | `List[PlanStep]` | **Y** | — | 플랜 단계 목록. **소비 계약** (data-models.md `PlanStep`) |
| `job_name` | `str \| null` | N | `null` | 폴더명(custom_name). 없으면 `job_{YYYYmmdd_HHMMSS}`. 중복 시 타임스탬프 suffix |
| `multi_atom_info` | `List[AtomInfo] \| null` | N | `null` | `len > 1`이면 다중구조 병렬 제출 분기 발동 |
| `cutoff` | `float` | N | `400.0` | 평면파 cutoff (Ry) |
| `rel_cutoff` | `float` | N | `50.0` | relative cutoff |
| `functional` | `str` | N | `'PBE'` | XC functional |
| `basis_set` | `str` | N | `'DZVP-MOLOPT-GTH'` | 기저함수 세트 |
| `method` | `str` | N | `'GPW'` | QS METHOD |
| `scf_algo` | `str` | N | `'OT'` | SCF 알고리즘 |
| `charge` | `int` | N | `0` | 전하 |
| `multiplicity` | `int` | N | `1` | 다중도 |
| `use_smear` | `bool` | N | `false` | SMEAR 사용 여부. 다중 분기는 구조별 `struct.get('use_smear')` 우선 |
| `smear_temp` | `float` | N | `300.0` | SMEAR 전자온도 (K) |
| `property` | `str` | N | `'energy'` | 물성 종류. **12종 중 단 하나만 선택하는 단일 문자열**(리스트/다중 선택 아님) |
| `custom_options` | `Dict[str,Any]` | N | `{}` | `expert_tip` 키만 오케스트레이터로 전달됨 |
| `eps_scf` | `str` | N | `'1.0E-6'` | SCF 수렴 임계 |
| `periodic` | `str` | N | `'XYZ'` | 주기성 |
| `max_scf` | `int \| null` | N | `null` | 최대 SCF 반복 |
| `ignore_scf_failure` | `bool` | N | `false` | SCF 실패 무시 |
| `basis_file` | `str \| null` | N | `null` | 기저함수 파일 경로 |
| `pot_file` | `str \| null` | N | `null` | 의사퍼텐셜 파일 경로 |
| `lsd` | `bool` | N | `false` | LSD(UKS) |
| `added_mos` | `str \| null` | N | `null` | ADDED_MOS |

`FileItem`(= `GeneratedFile`의 제출 측 호환 형태):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:--:|---|
| `filename` | `str` | **Y** | 단일 `step{i}.inp`, 다중 `{base}_step{i}.inp` |
| `content` | `str` | **Y** | CP2K `.inp` 텍스트(`build_full_inp` 결과) |
| `validation_logs` | `List \| null` | N | 검증 로그(제출 측 모델에만 존재, 소비 안 함) |

**요청 예시 (단일, 사전 생성 파일 제출)**
```json
{
  "files": [
    { "filename": "step1.inp", "content": "&GLOBAL\n  RUN_TYPE GEO_OPT\n&END GLOBAL\n..." }
  ],
  "atom_info": {
    "filename": "TiO2.cif",
    "atom_count": 6,
    "atoms": [{ "element": "Ti", "x": 0.0, "y": 0.0, "z": 0.0 }],
    "elements": ["Ti", "O"],
    "element_counts": { "Ti": 2, "O": 4 },
    "cell": [4.59, 4.59, 2.96],
    "full_coord_text": "Ti 0.0 0.0 0.0\nO 1.3 1.3 0.0",
    "full_cell_text": "ABC 4.59 4.59 2.96\nALPHA_BETA_GAMMA 90 90 90",
    "use_scaled": false
  },
  "steps": [
    {
      "step_name": "Geometry Optimization",
      "run_type": "GEO_OPT",
      "inp_options": ["FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6", "MOTION/GEO_OPT/MAX_ITER 200"],
      "selected": true
    }
  ],
  "job_name": "tio2_relax",
  "property": "geo_opt",
  "cutoff": 400.0,
  "rel_cutoff": 50.0,
  "functional": "PBE"
}
```

**응답 (`SubmitJobResponse`) — 단일구조**

| 필드 | 타입 | 설명 |
|---|---|---|
| `status` | `str` | `'success'` 고정 |
| `directory` | `str` | job 폴더 basename. 다운로드/리포트/라이브상태 조회 키. **`f5-report`가 `ReportRequest.job_dir`로 사용하는 유일한 `f4` 소비 필드** |
| `message` | `str` | 사용자 표시 메시지 |

```json
{
  "status": "success",
  "directory": "tio2_relax",
  "message": "시뮬레이션 오케스트레이션이 시작되었습니다 (SGE 제출 중)"
}
```

**응답 (`SubmitJobResponse`) — 다중구조 (`multi_atom_info` len > 1)**

| 필드 | 타입 | 설명 |
|---|---|---|
| `status` | `str` | `'success'` |
| `is_multi` | `bool` | `true` |
| `directory` | `str` | parent custom_name. 라이브상태/다운로드 키 |
| `sub_jobs` | `List[{filename:str, job_key:str}]` | 각 하위작업의 라이브상태 조회 키. `job_key = "{custom_name}_{safe_name}"` (safe_name = 파일명에서 비영숫자를 `_`로 치환) |
| `message` | `str` | 사용자 표시 메시지 |

```json
{
  "status": "success",
  "is_multi": true,
  "directory": "compare_run",
  "sub_jobs": [
    { "filename": "TiO2.cif", "job_key": "compare_run_TiO2" },
    { "filename": "SnO2.cif", "job_key": "compare_run_SnO2" }
  ],
  "message": "총 2개의 구조에 대한 병렬 계산 제출이 시작되었습니다."
}
```

**상태코드 / 에러**

| 코드 | 조건 |
|---|---|
| `200` | 제출 접수 성공(실제 SGE 제출은 백그라운드에서 진행, 실패는 라이브상태에 반영) |
| `422` | `SubmitRequest` 검증 실패(필수 `atom_info`/`steps` 누락 등) |
| `500` | 디렉토리 생성/메타 기록 등 라우트 내부 예외 (`작업 제출 도중 오류 발생: ...`) |

**부수효과**: 다중구조 분기는 parent `job_dir`에 `multi_metadata.json`을 기록한다(아래 `MultiMetadata` 계약 참조).

---

### 2) `GET /job-live-status/{job_key:path}` — 라이브 상태 조회

`job_key`는 path 파라미터이며 `/`를 포함할 수 있다(`:path`). `simulations/{job_key}/multi_metadata.json` 존재 여부로 단일/다중이 갈린다.

| 위치 | 파라미터 | 타입 | 설명 |
|---|---|---|---|
| path | `job_key` | `str` | 단일=`SubmitJobResponse.directory`, 다중 하위=`sub_jobs[].job_key`. `get_job_key()`가 `simulations/` 뒤 경로의 `/`를 `_`로 치환한 형태 |

요청 본문 없음.

**응답 (`JobLiveStatusResponse`)** — 단일/다중에 따라 형태가 다르다.

| 필드 | 타입 | 분기 | 설명 |
|---|---|---|---|
| `status` | `str` | 공통 | 단일=`JobStatus.status`, 다중=`'Running'`\|`'Completed'` |
| `is_multi` | `bool` | 다중 | 다중작업일 때만 `true` |
| `sub_jobs` | `List[{filename, job_key, status}]` | 다중 | 하위작업별 상태(`status`는 `'Completed'`/`'Failed'`/`'Running'`으로 정규화) |
| `message` | `str` | 다중/동적 | 요약 메시지 |
| `step_histories` | `Dict[str, StepHistory]` | 공통 | 단일=시계열 그래프 데이터, 다중=`{}` 빈 dict |
| `job_key` | `str` | 단일 동적복원 | 파일시스템 동적복원 시 포함 |

단일 작업의 본문은 `JobStatus` 계약 전체(`message`/`healing_history`/`logs`는 문자열화, `job_key` 주입)이거나, DB에 없으면 `simulations/{job_key}` 디렉토리를 `os.walk`로 훑어 `.out`을 파싱한 **동적복원 형태**다.

**응답 예시 — 단일 (Running)**
```json
{
  "status": "Running",
  "active_step": 1,
  "total_steps": 2,
  "job_id": "84213",
  "lang": "ko",
  "message": "Step 1 실행 중 (SCF 수렴 중)",
  "healing_history": [],
  "updated_at": "14:23:05",
  "logs": ["[Step 1] qsub submitted (job_id=84213)", " SCF run | iter 12 | -245.83"],
  "current_scf_step": 12,
  "energy_history": [-245.91, -245.86, -245.83],
  "scf_history": [1.2e-2, 4.5e-3, 9.8e-4],
  "scf_progress": 62.4,
  "macro_progress": 0.0,
  "steps": [{ "step_name": "Step 1: Geometry Optimization", "run_type": "GEO_OPT", "inp_options": {}, "selected": true }],
  "step_histories": {
    "1": { "run_type": "GEO_OPT", "energy": [-245.91, -245.83], "scf": [1.2e-2, 9.8e-4], "macro_energy": [], "macro_conv": [] }
  },
  "job_key": "tio2_relax"
}
```

**응답 예시 — 다중**
```json
{
  "status": "Running",
  "is_multi": true,
  "sub_jobs": [
    { "filename": "TiO2.cif", "job_key": "compare_run_TiO2", "status": "Completed" },
    { "filename": "SnO2.cif", "job_key": "compare_run_SnO2", "status": "Running" }
  ],
  "message": "비교 계산 진행 중",
  "step_histories": {}
}
```

**상태코드 / 에러**

| 코드 | 조건 |
|---|---|
| `200` | 항상 200. 미발견 작업은 본문 `{"status": "Unknown"}` 반환(별도 404 없음) |

---

### 3) `POST /job-stop` — 작업 중단

`job_id`로 `qdel`을 실행해 SGE 작업을 죽이고 `status='aborted'`로 영속화한다. 요청 본문은 **검증 모델이 아닌 raw `Dict`**다.

**요청 본문**

| 필드 | 타입 | 필수 | 설명 |
|---|---|:--:|---|
| `job_key` | `str` | **Y** | 중단할 작업 키(`SubmitJobResponse.directory` 또는 `sub_jobs[].job_key`) |

```json
{ "job_key": "tio2_relax" }
```

**응답**

| 필드 | 타입 | 설명 |
|---|---|---|
| `status` | `str` | `'success'` 또는 `'error'` |
| `message` | `str` | 결과 메시지 |

```json
{ "status": "success", "message": "작업 중단 요청 완료" }
```

`job_key`가 없으면: `{ "status": "error", "message": "job_key가 없습니다." }` (그래도 HTTP 200).

> 참고: `orchestrator.stop_job_suite(job_key)`는 내부적으로 작업이 DB에 없으면 `False`, 성공 시 `True`를 반환하지만, 라우트는 이 반환값과 무관하게 항상 `success`를 응답한다(clean 재설계 시 반환값을 응답에 반영 권장).

**상태코드**: `200` 고정.

---

### 4) `GET /download-job/{job_name}` — 결과 다운로드

`simulations/{job_name}/`을 `tar.gz`로 압축해 스트리밍 응답한다.

| 위치 | 파라미터 | 타입 | 설명 |
|---|---|---|---|
| path | `job_name` | `str` | `SubmitJobResponse.directory`(parent 폴더명) |

**응답**: `FileResponse` (`media_type="application/gzip"`, 파일명 `{job_name}.tar.gz`). 임시 파일(`tempfile.NamedTemporaryFile`)에 `tarfile`로 압축 후 전송.

**상태코드 / 에러**

| 코드 | 조건 |
|---|---|
| `200` | `tar.gz` 바이너리 |
| `404` | `simulations/{job_name}` 디렉토리 부재 (`Job directory not found`) |

---

## 생산하는 데이터 계약

이 기능이 내보내 다른 기능/프런트가 소비하는 구조. 상세 필드는 **data-models.md**의 동명 계약을 참조한다.

| 계약 | 형태 | 소비처 | 비고 |
|---|---|---|---|
| **`SubmitRequest`** | HTTP 요청 모델(Pydantic) | `f4-jobs`(자기 입력) | data-models.md `SubmitRequest`. 기본값이 타 모델과 다름 |
| **`SubmitJobResponse`** | HTTP 응답 | `f4-jobs`, **`f5-report`** | data-models.md `SubmitJobResponse`. `f5`는 `directory` 필드만 소비 |
| **`JobStatus`** | `job_status.json` 영속 + `/job-live-status` 단일 응답 | `f4-jobs` 내부 + 프런트 실시간 모니터 | data-models.md `JobStatus`. **`f5-report`는 소비하지 않음** |
| **`StepHistory`** | `JobStatus.step_histories[str(idx)]` 값 | `f4-jobs` 내부 + 프런트 그래프 | data-models.md `StepHistory` |
| **`MultiMetadata`** | parent `job_dir/multi_metadata.json` 파일 | `f4-jobs`, **`f5-report`** | data-models.md `MultiMetadata`. `app/features/report/service.py`가 디스크에서 직접 읽어 다중 비교 분기 결정 |
| **`SimulationArtifacts`** | `simulations/{directory}/` 디스크 파일(`*.out`/`*.pdos`/`*.bs`/`multi_metadata.json`) | **`f5-report`** | data-models.md `SimulationArtifacts`. 코드 객체가 아니라 **디스크 파일 포맷 약속** |
| **`JobLiveStatusResponse`** | `/job-live-status` 응답 | `f4-jobs` 내부 + 프런트 | data-models.md `JobLiveStatusResponse` |

**핵심 인터페이스 주의점 (소비자가 반드시 알아야 함)**

1. **`f5-report`는 `JobStatus`를 절대 읽지 않는다.** `app/features/report/service.py`는 `app/features/jobs/service.py`의 `orchestrator`를 import하지 않으며, `get_job_status`/`step_histories`/`active_step`/`healing_history`를 읽는 코드가 없다. `f5`가 `f4`에서 소비하는 것은 (a) `SubmitJobResponse.directory` 문자열, (b) `simulations/{job_dir}/` 디스크 산출물(`SimulationArtifacts`), (c) `multi_metadata.json`(`MultiMetadata`) 셋뿐이다.
2. **`directory`가 곧 계약 키다.** 다운로드, 리포트, 라이브상태가 모두 이 문자열(또는 다중 시 `sub_jobs[].job_key`)을 키로 쓴다.
3. **`MultiMetadata.sub_jobs[].filename`은 원본 파일명**(safe_name 변환 전)이고, `job_key`는 변환된 조회 키다. `app/features/report/service.py`가 둘 다 `.get`으로 읽는다.

---

## 소비하는 데이터 계약

상위 기능의 출력을 입력으로 받는다. 상위 기능이 미완성이어도 아래 **목업 JSON**으로 단독 개발을 시작할 수 있다.

### `AtomInfo` (from `f1-structure`)

`SubmitRequest.atom_info` 및 `multi_atom_info[]`로 실린다. 좌표 체이닝(GEO_OPT/CELL_OPT 후)에서 `full_coord_text`/`cell`이 갱신된다.

> **방어적 읽기 필수**: `AtomInfo`는 세 형태(정상/parse-failure 폴백/empty-CIF 폴백)의 키 집합이 다르다. 선택적 키는 반드시 `.get`으로 읽고, `atom_count == 0` 및 `error` 키 유무를 체크할 것. `app/features/jobs/service.py`의 오케스트레이터가 직접 참조하는 키: `elements`, `atom_count`, `cell`, `periodic`(기본 `'XYZ'`), `full_coord_text`.

**목업 (정상 경로)**
```json
{
  "filename": "TiO2.cif",
  "atom_count": 6,
  "atoms": [
    { "element": "Ti", "x": 0.0, "y": 0.0, "z": 0.0 },
    { "element": "O", "x": 1.31, "y": 1.31, "z": 0.0 }
  ],
  "elements": ["Ti", "O"],
  "element_counts": { "Ti": 2, "O": 4 },
  "element_indices": { "Ti": [1, 2], "O": [3, 4, 5, 6] },
  "cell": [4.59, 4.59, 2.96],
  "cell_angles": [90.0, 90.0, 90.0],
  "volume": 62.4,
  "full_coord_text": "Ti 0.0 0.0 0.0\nTi 2.30 2.30 1.48\nO 1.31 1.31 0.0",
  "full_cell_text": "ABC 4.59 4.59 2.96\nALPHA_BETA_GAMMA 90.0 90.0 90.0",
  "use_scaled": false,
  "periodic": "XYZ"
}
```

**목업 (empty-CIF 폴백 — 방어 테스트용)**
```json
{
  "filename": "broken.cif",
  "atom_count": 0,
  "atoms": [],
  "elements": [],
  "element_counts": {},
  "cell": [10.0, 10.0, 10.0],
  "full_coord_text": "",
  "full_cell_text": "ABC 10.0 10.0 10.0\nALPHA_BETA_GAMMA 90 90 90",
  "use_scaled": false,
  "error": "Empty CIF (No atoms)"
}
```

### `PlanStep` (from `f2-plan`)

`SubmitRequest.steps[]`로 실린다. 오케스트레이터가 `.get`으로 방어적으로 읽는다.

> **`active_tokens` 경로 주의**: 제출/inp 단계에서는 **step 키**로 읽혀 `build_full_inp`/AI 치유 메타에 전달된다(`step.get('active_tokens', [])`). (플랜 생성 단계의 `req.active_tokens`(`PlanRequest` 동적 속성)와는 다른 소비처다.) 따라서 본 기능에 들어오는 `active_tokens`는 **step 키**에서 읽는다.

**목업 (단일 step)**
```json
[
  {
    "step_idx": 1,
    "step_name": "Geometry Optimization",
    "importance": "필수",
    "run_type": "GEO_OPT",
    "physics_reason": "초기 좌표 이완으로 안정 구조 확보",
    "objective": "안정 구조",
    "inp_options": [
      "FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6",
      "FORCE_EVAL/DFT/SCF/MAX_SCF 50",
      "MOTION/GEO_OPT/MAX_ITER 200"
    ],
    "active_tokens": ["GEO_OPT_TIGHT"],
    "selected": true,
    "exclude": false
  }
]
```

> `inp_options`가 `List[str]`이면 오케스트레이터가 `app/shared/options.py`의 `parse_path_based_options`로 dict 변환한다. 이미 `Dict[str,Any]`면 그대로 사용. `selected=false` 또는 `exclude=true`인 step은 `_reindex_active_steps`에서 제외된다.

### `GeneratedFile` (from `f3-inp`)

`SubmitRequest.files[]`(= `FileItem`)로 실린다. `null`이면 오케스트레이터가 step별로 자동 생성하므로, **`f3`가 미완성이어도 `files=null`로 제출하면 자동 생성 경로로 단독 개발 가능**하다.

**목업**
```json
[
  {
    "filename": "step1.inp",
    "content": "&GLOBAL\n  PROJECT step1\n  RUN_TYPE GEO_OPT\n&END GLOBAL\n&FORCE_EVAL\n  METHOD QS\n  ...\n&END FORCE_EVAL\n",
    "validation_logs": null
  }
]
```

---

## 내부·공유 의존성

| 공유 모듈 | import | 호출 방식 / 시그니처 | 용도 |
|---|---|---|---|
| `app/shared/self_healing.py` | `from app.shared.self_healing import healing_engine` | `validate_and_correct(options, mandatory_params) -> (options, logs)` | 제출 전 inp 옵션 정규화·물리 규칙 강제 |
| `app/shared/self_healing.py` | 〃 | `diagnose(log_tail, lang='ko') -> (diag_id, match_groups, human_msg)` | 실패 로그 진단 |
| `app/shared/self_healing.py` | 〃 | `heal(options, diag_id, match_groups, retry_count=0, lang='ko') -> (new_options, heal_logs)` | DB 기반 결정론적 치유 |
| `app/shared/self_healing.py` | 〃 | `heal_with_ai(options, log_tail, retry_count=0, previous_fixes=None, job_dir=None, failure_history=None, ai_meta=None, lang='ko') -> (new_options, ai_logs, ai_msg)` | **AI 치유 (`asyncio.run`으로 호출)**. Anthropic API 간접 호출 (`app/core/llm.py` 클라이언트 경유) |
| `app/shared/self_healing.py` | 〃 | `get_retry_filenames(step_dir, base_inp, retry_count) -> (step_dir, inp_filename, sh_filename)` | 재시도 파일명(`{name}_retry_{n}.inp/.sh`) |
| `app/shared/self_healing.py` | 〃 | `record_success()` | 성공 시 치유 지식 베이스 영구 저장 |
| `app/shared/options.py` | `from app.shared.options import parse_path_based_options` | `parse_path_based_options(path_list: List[str]) -> Dict` | 경로형 옵션 → 계층 dict |
| `app/features/inp/service.py` | `from app.features.inp.service import build_full_inp` | `build_full_inp(tree, atom_info, step_idx=1, all_steps=..., run_type=..., cutoff, rel_cutoff, functional, basis_set, method, scf_algo, charge, multiplicity, use_smear, smear_temp, active_tokens) -> str` | `.inp` 파일 내용 렌더링 |
| `app/shared/physics_patterns.py` | `from app.shared.physics_patterns import PHYSICS_PATTERNS` (지연 import) | 정규식 dict. `_parse_live_data`가 키 `'scf_step'`, `'total_energy'`, `'geo_max_grad'` 사용 | 라이브 로그 파싱 |
| `app/features/jobs/schemas.py` | `from app.features.jobs.schemas import SubmitRequest, FileItem` | Pydantic 모델 | `/submit-job` 요청 검증. `FileItem` = `GeneratedFile` 호환 |
| `app/shared/schema_engine.py` (간접) | `self_healing.validate_and_correct` 내부에서 `app/shared/schema_engine.py` 사용 | — | inp 정규화의 단일 거버넌스 엔진. `f4`는 직접 import하지 않음 |

**스레딩**: `orchestrator`는 `threading.RLock`(`self._lock`)으로 `job_status_db`(dict) 접근을 직렬화한다. `__init__`에서 데몬 스레드로 `_resume_all_monitoring()`을 띄워 **서버 재시작 시 Running 작업을 복구**한다. `_monitor_and_chain`도 step별 데몬 스레드로 실행된다.

**라우터와의 계약**: `app/features/jobs/router.py`의 `/submit-job` 라우트가 `SubmitRequest` 필드를 `BackgroundTask`로 `orchestrator.start_job_suite(...)`에 매핑한다. `files` → `provided_files`(dict), `custom_options.expert_tip` → `expert_tip` 키워드 인자로 전달.

```python
# orchestrator.start_job_suite 시그니처 (app/features/jobs/router.py가 BackgroundTask로 호출)
start_job_suite(self, job_dir: str, steps: List[Dict[str,Any]], atom_info: Dict[str,Any],
                lang: str='ko', cutoff: float=400.0, rel_cutoff: float=50.0,
                functional: str='PBE', basis_set: str='DZVP-MOLOPT-GTH',
                method: str='GPW', scf_algo: str='OT', charge: int=0, multiplicity: int=1,
                use_smear: bool=False, smear_temp: float=300.0,
                provided_files: Dict[str,str]=None, expert_tip: str=None) -> None
```

---

## 외부 의존성

| 분류 | 항목 | 값 / 경로 |
|---|---|---|
| **SGE 바이너리** | qsub / qstat / qdel | `/usr/lib/gridengine/qsub`, `/usr/lib/gridengine/qstat`, `/usr/lib/gridengine/qdel` (`subprocess`로 실행) |
| **SGE 환경변수** | `SGE_ROOT` | `/var/lib/gridengine` |
| | `SGE_CELL` | `Faraday` |
| | `PATH` | `/usr/lib/gridengine:$PATH` (subprocess env로 주입) |
| **SGE 큐/PE** | 큐 / 병렬환경 | `-q gp3`, `-pe 16cpu 16` (재시도 시 `-pe 8cpu 8` / `-n 8`로 다운스케일) |
| **CP2K 실행환경** | `CP2K_ROOT` | `/share/cp2k-2026.1_mkl` |
| | `CP2K_DATA_DIR` | `/share/cp2k-2026.1_mkl/data` |
| | venv | `/DATA/lab07/hglee/cp2k_agent/venv/bin/activate` |
| | Intel oneAPI | `/share/intel/oneAPI/setvars.sh`, MPI `/share/intel/oneAPI/mpi/2021.17/bin/mpiexec -n 8 cp2k.psmp` |
| | MPI/MKL 환경 | `FI_PROVIDER=tcp`, `MKL_DEBUG_CPU_TYPE=5`, `OMP_NUM_THREADS=1` |
| | SGE 배치/셸 하드닝 | `#$ -S /bin/bash`, `#$ -V`, `#$ -cwd`, `ulimit -s unlimited`, `LD_LIBRARY_PATH`에 CP2K toolchain libs. **`-pe`는 `CLUSTER_PE` 통째(`16cpu 16`), 랭크는 `mpiexec -n {CLUSTER_MPI_RANKS}`(8)** — 랭크를 `-pe`에 붙이지 말 것. 정본 템플릿: `docs/build-prompts/be/05-f4-jobs.md`. |
| **Anthropic API (간접)** | Claude (로그상 `Claude-Sonnet-4-6`) | `app/shared/self_healing.py`의 `heal_with_ai`가 `app/core/llm.py` 클라이언트를 통해 내부에서 호출. API 키는 `.env`(`load_dotenv()`)에서 로드. **`f4`는 키를 직접 다루지 않음** |
| **파일시스템** | 상태 DB | `STATUS_DB_PATH = <app/features/jobs/service.py 디렉토리>/job_status.json` (원자적 쓰기 `.tmp` → `os.replace`) |
| | 작업 트리 | `simulations/{job_dir}/step{idx}_{run_type}/` 하위에 `step{idx}.inp`, `step{idx}.sh`, 재시도 `*_retry_{n}.*` |
| | 결과 파일 | `*.out`, `*-pos-1.xyz`(좌표 체이닝), `*-1.cell`(CELL_OPT), `error_heal.log`, `simulation_completed.flag` |
| | 경로 정규화 | `root_dir = os.path.dirname(os.path.dirname(__file__))` (상위의 상위) |
| **표준 라이브러리** | 압축/임시파일 | `tarfile`, `tempfile`, `io` (`/download-job` 응답) |
| | 기타 | `subprocess`, `threading`, `re`, `json`, `asyncio`(heal_with_ai), `datetime` |

> **OS 주의**: SGE/CP2K 실행은 **Linux(Faraday 클러스터)** 전용이다. Windows 개발 환경에서는 `qsub`/`qstat`/`qdel` subprocess 호출이 실패하므로, 단독 개발 시 SGE 레이어를 목업해야 한다(아래 병렬 개발 가이드 참조).

---

## 병렬 개발 가이드

### 무엇을 목업하면 단독 개발이 가능한가

이 기능은 **외부 SGE 클러스터·상위 기능 출력 둘 다 없이도** 개발을 시작할 수 있다. 다음을 목업하라.

1. **SGE 레이어 (`qsub`/`qstat`/`qdel`)** — 가장 중요.
   - `subprocess` 호출을 가로채는 페이크를 둔다. `qsub`는 가짜 `job_id`(예 `"99999"`)를 stdout으로 반환, `qstat`는 N회 호출 후 빈 결과(작업 종료)를 반환, `qdel`은 성공 코드 반환.
   - 또는 `QSUB_PATH`/`QSTAT_PATH`/`QDEL_PATH`를 로컬 스텁 스크립트 경로로 환경에서 오버라이드(clean 재설계 시 이 경로들을 설정 가능하게 만들 것).
   - `.out` 산출물을 직접 디스크에 써 두면 `_monitor_and_chain`/동적복원 경로를 단독 검증할 수 있다.

2. **`app/shared/self_healing.py` 엔진 (Anthropic API 간접)**.
   - `healing_engine`을 스텁으로 대체: `diagnose` → `(None, {}, "no error")`, `heal_with_ai` → `(options, [], "")`(무처방)로 두면 AI/네트워크 없이 정상 경로를 테스트할 수 있다. 실패 경로 테스트 시에만 처방을 반환하도록.

3. **상위 기능 입력 (`AtomInfo`/`PlanStep`/`GeneratedFile`)**.
   - 위 "소비하는 데이터 계약"의 목업 JSON을 그대로 `/submit-job` 본문에 넣는다. `files=null`로 두면 `f3-inp` 없이 자동 생성 경로를 탄다.

4. **`app/features/inp/service.py`의 `build_full_inp` / `app/shared/options.py`의 `parse_path_based_options`** (선택).
   - 실제 모듈을 그대로 써도 되지만, `.inp` 렌더링 세부에 의존하지 않으려면 `build_full_inp`를 `"<mock inp>"` 문자열 반환 스텁으로 둘 수 있다.

5. **파일시스템**.
   - `simulations/`, `job_status.json`을 임시 디렉토리로 격리(테스트마다 `tmp_path`). `STATUS_DB_PATH`는 모듈 로드 시 결정되므로 monkeypatch 필요.

### 목업으로 검증 가능한 시나리오

- 단일구조 제출 → `job_status.json`에 `status='Running'` 엔트리 생성 확인.
- 다중구조 제출 → `multi_metadata.json` 기록 + `SubmitJobResponse.sub_jobs` 키 형식(`{custom_name}_{safe_name}`) 확인.
- `/job-live-status` 단일/다중 응답 형태 분기 확인(`multi_metadata.json` 유무).
- `/job-stop` → `qdel` 스텁 호출 + `status='aborted'` 영속화 확인.
- `/download-job` → 존재하는 디렉토리 `tar.gz` 200, 부재 시 404.
- 실패 로그 주입 → `diagnose`/`heal` 스텁 처방 적용 → `retry_count` 증가 → 재시도 파일명(`*_retry_{n}.*`) 생성 확인.

### 완료 정의 (Definition of Done)

- [ ] `POST /submit-job` 단일/다중 분기 모두 명세대로 응답(`SubmitJobResponse`).
- [ ] `BackgroundTask`로 `start_job_suite` 호출되고 `job_status.json`에 `JobStatus` 엔트리가 영속화됨(원자적 쓰기).
- [ ] `GET /job-live-status/{job_key:path}` 단일=`JobStatus`(문자열화 + `job_key` 주입), 다중=집계, DB 없을 때 디스크 동적복원 모두 동작. 미발견 시 `{"status":"Unknown"}`.
- [ ] `POST /job-stop` 가 `qdel`을 호출하고 `status='aborted'` 영속화. `job_key` 누락 시 error 메시지.
- [ ] `GET /download-job/{job_name}` 가 `tar.gz` 스트리밍, 부재 시 404.
- [ ] 단계 간 좌표 체이닝(GEO_OPT/CELL_OPT 후 `*-pos-1.xyz`/`*-1.cell` 반영)이 `atom_info.full_coord_text`/`cell`에 주입됨.
- [ ] 실패 → `self_healing` 진단/치유 → `retry_count ≤ 3` 재시도, 초과 시 `status='Failed'` + `error_heal.log`에 `HEALING FAILED`/`MAX RETRIES EXCEEDED` 기록.
- [ ] 성공 완료 시 `simulation_completed.flag`에 `'completed'` 기록, `status='all_finished'`.
- [ ] **생산 계약 형태 일치 검증**: `JobStatus`/`StepHistory`/`MultiMetadata`/`SimulationArtifacts`/`SubmitJobResponse`/`JobLiveStatusResponse`가 data-models.md 계약과 키·타입이 일치(특히 `f5-report`가 의존하는 `directory` 문자열, `multi_metadata.json`의 `sub_jobs[].filename`/`job_key`, 디스크 `*.out` 포맷).
- [ ] 서버 재시작 후 `_resume_all_monitoring`이 `suite_params` 스냅샷으로 Running 작업을 복구.
- [ ] (통합 단계) 실제 Faraday SGE에서 1-step ENERGY 작업이 제출→완료→상태 노출까지 end-to-end 동작.

### 통합 시 주의 (계약 안정성)

- `SubmitJobResponse.directory`는 `f5-report`의 유일한 `f4` 입력이므로 **필드명/의미를 바꾸면 `f5`가 깨진다**. 단일=basename, 다중=parent custom_name 규칙을 유지할 것.
- `multi_metadata.json`은 `f5-report`가 디스크에서 직접 파싱한다. `is_multi`/`parent_job_key`/`sub_jobs[].{filename,job_key}`/`property`/`steps`/`timestamp` 키를 유지할 것.
- `simulations/{job}/*.out` 파일 포맷(`ENERGY| Total FORCE_EVAL ...` 라인, `PHYSICS_PATTERNS` 정규식 대응)은 `f5`/동적복원이 의존하는 암묵 계약이다.
