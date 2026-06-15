# 결과 리포트 생성 (Result Report Generation) — `f5-report`

## 구현 위치 (폴더 구조)

이 기능은 `app/features/report/` 아래에 구현된다: HTTP 엔드포인트는 `router.py`, 분석/추출/리포트 생성 로직은 `service.py`, 기능 전용 요청 모델(`ReportRequest` 등)은 `schemas.py`, 리포트용 프롬프트는 `prompts.py`에 둔다.
cross-feature 모델(`ReportData`, `MultiMetadata`, `SimulationArtifacts` 등)은 `app/schemas/common.py`에 정의되고, 공유 엔진(물성 정규식 패턴, self-healing, schema engine 등)은 `app/shared/*`에 위치한다. LLM 클라이언트는 `app/core/llm.py`를 통해 사용한다.

> **한 줄 책임**: 완료된 작업 디렉토리(`job_dir`)를 walk하며 `.out`/`.pdos`/`.bs` 로그에서 12종 물성과 총에너지를 정규식 + AI 폴백으로 추출하고, `multi_metadata.json` 유무에 따라 **단일** 또는 **다중구조 비교** 마크다운 리포트를 LLM(또는 폴백 템플릿)으로 생성한다.

| 항목 | 값 |
| :--- | :--- |
| **Feature ID** | `f5-report` |
| **담당 모듈** | `app/features/report/service.py` (HTTP 래퍼는 `app/features/report/router.py`의 `POST /generate-report`) |
| **소유 범위 (Owned)** | `app/features/report/service.py` 전체 — `generate_report_logic`, `extract_target_property`, `parse_pdos_file`, `parse_bs_file`, `is_calculation_successful`, `ai_semantic_extract`, `get_property_mapping`, `PROPERTY_MAPPING` |
| **엔드포인트** | `POST /generate-report` |
| **생산 계약** | `ReportRequest`, `ReportData` |
| **소비 계약** | `MultiMetadata`, `SimulationArtifacts` (둘 다 `f4-jobs`가 디스크에 기록) |

### 설계 원칙 (clean 목표)

이 기능은 **상태 머신이 아니라 순수 결과 분석기**다. 다음 두 가지 경계를 반드시 지킨다.

1. **`JobStatus` / `app/features/jobs/service.py`를 소비하지 않는다.** `app/features/report/service.py`는 `app/features/jobs/service.py`를 import하지 않으며, `get_job_status` / `step_histories` / `active_step` / `healing_history`를 읽는 코드가 없다. 작업의 "진행 상태"가 아니라 **디스크에 남은 산출물**만 본다.
2. **`f4`로부터 필요한 것은 단 두 가지뿐이다.**
   - `directory` 문자열 — `SubmitJobResponse.directory` → `ReportRequest.job_dir`로 그대로 전달됨 (`f4`에서 소비하는 유일한 코드 필드).
   - 디스크 산출물 — `SimulationArtifacts`(`.out`/`.pdos`/`.bs`) + 선택적 `multi_metadata.json`(`MultiMetadata`).

---

## HTTP API 명세

### `POST /generate-report`

완료된 작업 디렉토리를 분석해 마크다운 연구 리포트와 요약 dict를 반환한다.

- **method**: `POST`
- **path**: `/generate-report`
- **Content-Type**: `application/json`

#### 요청 본문 (`ReportRequest`)

| 필드명 | 타입 | 필수 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| `job_dir` | `str` | ✅ | — | `simulations/` 하위 작업 폴더명. `SubmitJobResponse.directory`를 그대로 사용한다. 단일=job 폴더 basename, 다중=parent custom_name. |
| `property` | `str` | ❌ | `"geo_opt"` | 12종 물성 키 중 하나. 아래 [지원 물성 키](#지원-물성-키-property) 참고. 대소문자 무관(내부에서 `.lower()` 처리). |
| `lang` | `str` | ❌ | `"ko"` | `"ko"` 또는 `"en"`. `"en"`이면 영문 리포트 + 영문 폴백 템플릿 + 영문 에러 메시지. |

> **clean 노트**: 현재 `app/features/report/router.py`는 `req: Dict[str, Any]`로 raw dict를 받고 `req.get(...)`으로 읽는다. clean 재설계에서는 `ReportRequest`를 Pydantic 모델로 정의해 검증·기본값·OpenAPI 스키마를 자동화하는 것을 권장한다. 필드명/기본값은 위 표를 SSOT로 삼을 것.

#### 지원 물성 키 (`property`)

`geo_opt`, `single_point`, `dos`, `band`, `aimd`, `vibrational`, `neb`, `adsorption`, `work_function`, `hirshfeld`, `absorption`, `emission` (총 12종).
미등록 키를 보내도 에러는 아니다. `get_property_mapping`이 `"{KEY} 특성 분석"` 형태의 기본값으로 폴백하며, 정규식 매칭은 실패해 AI 폴백으로 넘어간다.

> **물성 키 집합 정합성 노트**: 위 12종은 `f6-benchmark`의 `LEVEL_TO_PROPERTY` 매핑(레벨 12 = `hirshfeld`) 및 `data-models.md`의 표준 계약과 **동일 집합**이다. 두 기능은 `app/shared/physics_patterns.py`의 `PHYSICS_PATTERNS`와 물성 추출 경로를 공유하므로, 레벨 12 산출물(`hirshfeld`)을 이 리포트로 분석하려면 양쪽 물성 키가 반드시 일치해야 한다. 레벨 12의 정본 키는 `hirshfeld`이다(`bader` 아님).

#### 응답 JSON 스키마 (`ReportData`)

```jsonc
{
  "status": "success",          // str.  정상/폴백 시 "success".
  "report": "마크다운 본문...",   // str.  LLM 생성 또는 폴백 템플릿 마크다운.
  "summary": { /* ... */ },      // 단일/다중에 따라 형태가 다름 (아래 참고)
  "is_multi": true               // bool. 다중구조 비교 리포트일 때만 포함됨.
}
```

`summary`는 단일/다중에 따라 형태가 다르다.

| 분기 | `summary` 형태 |
| :--- | :--- |
| **단일** | `{ "final_energy": str, "target_property": str }` |
| **다중** | `{ "<구조파일명>": { "energy": str, "target_property": str }, ... }` |

추출 실패 시 `final_energy` / `target_property` / `energy`의 값은 문자열 `"N/A"`가 된다(키 자체는 존재).

#### 상태코드 / 에러

| 상황 | HTTP | 응답 body |
| :--- | :--- | :--- |
| 정상 (단일) | `200` | `{status, report, summary{final_energy, target_property}}` |
| 정상 (다중) | `200` | `{status, is_multi:true, report, summary{<fname>:{...}}}` |
| 디렉토리 없음 | `200` | `{report:"시뮬레이션 디렉토리를 찾을 수 없습니다.", summary:{}}` — **축약형 (status/is_multi 없음)** |
| 추출 데이터 없음 | `200` | `{report:"추출된 물리 데이터가 없습니다...", summary:{}}` — **축약형** |
| LLM 호출 실패 | `200` | `status:"success"` + **폴백 템플릿** 마크다운 + 정상 `summary` (정규식으로 뽑은 값 사용) |
| 서버 예외 | `500` | `{status:"error", message:"..."}` (`app/features/report/router.py` try/except에서 처리) |

> **⚠️ 현재 동작 vs clean 목표 (반드시 인지)**
> `app/features/report/service.py`의 `generate_report_logic`는 디렉토리/데이터 없음 시 `status` 키가 **없는** 축약형 dict를 반환한다. 그런데 `app/features/report/router.py`는 `return {"status": "success", **report_data}`로 **무조건 `status:"success"`를 덧씌운다.** 따라서 현재 라이브 응답은 에러 케이스에서도 `status:"success"`로 나간다.
> **clean 목표**: 에러 dict는 `status:"error"`(또는 적절한 HTTP 4xx/404)로 명확히 구분하고, `app/features/report/router.py`가 무조건 덧씌우지 않도록 한다. 프런트는 당분간 **`summary == {}` 이면서 `report`가 에러 문구**인지로 방어적 체크할 것.

#### 요청 예시 1 — 단일 구조

```json
{
  "job_dir": "job_20260612_154210",
  "property": "absorption",
  "lang": "ko"
}
```

#### 응답 예시 1 — 단일 구조

```json
{
  "status": "success",
  "report": "# 양자화학 시뮬레이션 최종 연구 리포트\n\n## 1. 개요 및 연구 요약\n\n본 TDDFPT 계산은 ...\n\n* **최종 기저상태 에너지**: `-1234.567890 au`\n* **주요 타겟 물성치**: `λ_max: 412.5 nm (3.006 eV, f=0.842)`\n...",
  "summary": {
    "final_energy": "-1234.567890",
    "target_property": "λ_max: 412.5 nm (3.006 eV, f=0.842)"
  }
}
```

> 파장은 외부 의존성의 단위 변환 상수 `E(eV)→λ(nm) = 1239.84 / E`를 따른다. `1239.84 / 3.006 ≈ 412.5 nm`이므로 위 예시 수치는 내부 정합한다.

#### 요청 예시 2 — 다중 구조 비교 (`property` 생략 → `geo_opt`)

```json
{
  "job_dir": "perovskite_screening",
  "lang": "en"
}
```

#### 응답 예시 2 — 다중 구조 비교

```json
{
  "status": "success",
  "is_multi": true,
  "report": "# Multi-Structure Simulation Comparative Analysis Report\n\n## 1. Structure Comparison Table\n\n| Structure | Final Energy (au) | ... |\n...",
  "summary": {
    "MAPbI3.cif": { "energy": "-2456.112233", "target_property": "Max Force Grad: 0.000412" },
    "MAPbBr3.cif": { "energy": "-2401.998877", "target_property": "Max Force Grad: 0.000389" }
  }
}
```

#### 응답 예시 3 — 에러 (디렉토리 없음, 현재 동작 기준)

```json
{
  "status": "success",
  "report": "시뮬레이션 디렉토리를 찾을 수 없습니다.",
  "summary": {}
}
```
> clean 목표에서는 `status:"error"` + HTTP 404 권장. (위 [⚠️ 박스](#상태코드--에러) 참고)

---

## 생산하는 데이터 계약

이 기능이 정의·생산하여 다른 기능(주로 프런트엔드)이 소비하는 구조.

### 1. `ReportRequest` → [`data-models.md#ReportRequest`](../../data-models.md#reportrequest)

- **생산자**: `f5-report` (이 기능이 계약의 정의 주체)
- **소비자**: `f5-report` (자기 엔드포인트 요청 본문)
- 필드: `job_dir`(필수), `property`(기본 `geo_opt`), `lang`(기본 `ko`). 위 [요청 본문 표](#요청-본문-reportrequest) 참고.

### 2. `ReportData` → [`data-models.md#ReportData`](../../data-models.md#reportdata)

- **생산자**: `f5-report`
- **소비자**: 없음 (프런트엔드가 마크다운 렌더링용으로 직접 소비; 다운스트림 기능 없음)
- `report`(마크다운 본문) + `summary`(단일/다중 분기) + 선택적 `is_multi`. 위 [응답 스키마](#응답-json-스키마-reportdata) 참고.

> `report` 필드는 헤더/표/blockquote(`> [!NOTE]`)를 포함한 마크다운 텍스트다. 프런트는 마크다운 렌더러(`> [!NOTE]` admonition 지원 권장)로 표시한다.

---

## 소비하는 데이터 계약

이 기능이 필요로 하는 상위 기능(`f4-jobs`)의 출력. **둘 다 코드 객체가 아니라 `simulations/{job_dir}/` 하위의 디스크 파일**이다. 아래 목업을 디스크에 만들어 두면 `f4` 완성 전에도 단독 개발이 가능하다.

### 1. `SimulationArtifacts` ← `f4-jobs` → [`data-models.md#SimulationArtifacts`](../../data-models.md#simulationartifacts)

`f4`(또는 `f6`)가 작업 실행 시 `simulations/{directory}/` 하위에 기록하는 CP2K 로그 파일 묶음. `generate_report_logic`이 `os.walk`로 훑는다.

| 파일 | 필수 | reporter 처리 |
| :--- | :--- | :--- |
| `*.out` | ✅ | `PHYSICS_PATTERNS["total_energy"]` + 물성별 정규식으로 총에너지/12종 물성 추출. **파일명에 `-r-` 또는 `BAND` 포함 시 walk에서 제외** (병렬 프로세스 로그/이미지 밴드). |
| `*.pdos` | ❌ | `dos`/`band` 보조. `parse_pdos_file`이 a.u.→eV(×27.2114) 변환, `fermi`/`gap` 파싱. |
| `*.bs` | ❌ | band structure. `parse_bs_file`이 `# Point N` 분할로 HOMO-LUMO gap(eV) 계산. |
| `multi_metadata.json` | ❌ | 존재 시 **다중 비교 분기** 트리거(아래 `MultiMetadata`). 부재 시 단일 리포트. |

**목업 — `.out` 파일** (`simulations/MOCK_JOB/step1/cp2k.out`):
```text
 CP2K| version string:                 CP2K version 2024.1
 ...
 ENERGY| Total FORCE_EVAL ( QS ) energy [a.u.]:        -1234.567890123456
 ...
 OPT| Maximum gradient                          0.000412
 ...
 -------------------------------------------------------------------------------
 *                            PROGRAM ENDED AT                                  *
 -------------------------------------------------------------------------------
```
> `PROGRAM ENDED` 문자열은 `is_calculation_successful`의 게이트다. **이 줄이 없으면 AI 폴백이 호출되지 않는다** — 목업에 반드시 포함할 것.

**목업 — `.pdos` 파일** (`dos`/`band` 테스트용):
```text
# Projected DOS for atomic kind Si at iteration step i = 0, E(Fermi) =    0.123456 a.u.
#  MO Eigenvalue [a.u.]  Occupation     s         p
    1     -0.512340       2.000000   0.99   0.01
    2     -0.498210       2.000000   0.98   0.02
    3      0.045120       0.000000   0.10   0.90
```
> `fermi = 0.123456 × 27.2114 ≈ 3.357 eV`, `gap = (0.045120 − (−0.498210)) × 27.2114 ≈ 14.78 eV`.

**목업 — `.bs` 파일** (band structure):
```text
# Set 1: 10 special points, 5 bands
# Point 1
Band 1   -5.4321   2.0
Band 2   -1.2345   2.0
Band 3    0.9876   0.0
# Point 2
Band 1   -5.4000   2.0
Band 2   -1.2000   2.0
Band 3    1.0500   0.0
```

### 2. `MultiMetadata` ← `f4-jobs` → [`data-models.md#MultiMetadata`](../../data-models.md#multimetadata)

다중구조 제출 시 parent `job_dir/multi_metadata.json`에 기록된다. reporter는 이 파일을 디스크에서 직접 읽어 다중 비교 분기를 결정한다. **reporter가 실제 읽는 키만** 명시한다.

| 키 | 타입 | reporter 사용 방식 |
| :--- | :--- | :--- |
| `sub_jobs` | `List[{filename, job_key}]` | `multi_meta.get("sub_jobs", [])`. 각 항목을 순회. |
| `sub_jobs[].filename` | `str` | `.get("filename")`. 확장자 제거 + 영숫자/`_`/`-`만 남긴 `safe_name`으로 **우선 경로 해석** (`job_path/{safe_name}`), `comparison_summaries`의 **키**로도 사용. |
| `sub_jobs[].job_key` | `str` | `.get("job_key")`. `safe_name` 경로가 없으면 **폴백 경로** `simulations/{job_key}`로 사용. |

> 나머지 키(`is_multi`, `parent_job_key`, `property`, `steps`, `timestamp`)는 `f4`가 쓰지만 reporter는 읽지 않는다. 목업에 넣어도 무방하나 reporter 동작에는 무관.

**목업 — `simulations/perovskite_screening/multi_metadata.json`**:
```json
{
  "is_multi": true,
  "parent_job_key": "perovskite_screening",
  "sub_jobs": [
    { "filename": "MAPbI3.cif",  "job_key": "job_20260612_154210" },
    { "filename": "MAPbBr3.cif", "job_key": "job_20260612_154233" }
  ],
  "property": "geo_opt",
  "steps": [],
  "timestamp": "20260612_154210"
}
```
> 위 목업과 함께 `simulations/perovskite_screening/MAPbI3/cp2k.out`, `.../MAPbBr3/cp2k.out`(safe_name 폴더) 를 만들면 다중 비교 분기를 단독으로 검증할 수 있다.

---

## 내부 · 공유 의존성

| 의존 대상 | import / 호출 방식 | 용도 |
| :--- | :--- | :--- |
| `app/shared/physics_patterns.py`의 `PHYSICS_PATTERNS` | `from app.shared.physics_patterns import PHYSICS_PATTERNS` | 정규식 패턴 dict. `extract_target_property`가 키(`total_energy`, `homo_lumo`, `fermi_energy`, `excitation`, `geo_max_grad`, `neb_energy`, `neb_barrier`, `md_step`, `vib_freq`)로 참조. **`scf_step`/`geo_max_step`은 dict에 있으나 reporter는 미사용.** |
| `app/features/report/prompts.py`의 `REPORT_PROMPT` | `from app.features.report.prompts import REPORT_PROMPT` | 단일 리포트 system 프롬프트. `REPORT_PROMPT.format(context=full_context)`로 바인딩. `lang=="en"`이면 마지막 "언어" 지시문을 영어로 `replace`. |
| `app/features/report/prompts.py`의 `COMPARATIVE_REPORT_PROMPT` | `from app.features.report.prompts import COMPARATIVE_REPORT_PROMPT` | 다중 비교 system 프롬프트. `.format(context=...)` 동일 패턴. |
| `app/core/llm.py` (Anthropic 클라이언트) | `from app.core.llm import ...` | LLM 클라이언트 (아래 [외부 의존성](#외부-의존성) 참고). |
| 표준 라이브러리 | `os`, `re`, `json`, `logging`, `typing` | 파일 walk, 정규식, JSON 직렬화, 로깅. |

**`app/shared/physics_patterns.py`의 `PHYSICS_PATTERNS` 호출 핵심 패턴** (목업 시 그대로 따를 것):
```python
# app/shared/physics_patterns.py 정의 (reporter가 소비)
PHYSICS_PATTERNS = {
    "total_energy": r"ENERGY\|\s+Total\s+FORCE_EVAL\s+.*?energy\s+.*?(-?\d+\.\d+)",
    "homo_lumo":    r"HOMO\s*-\s*LUMO\s*gap\s*\[eV\]\s*:\s*([-+]?\d*\.?\d+)",
    "geo_max_grad": r"OPT\|\s+Maximum\s+gradient\s+([-+]?\d*\.?\d+(?:[Ee][-+]?[\d.]+)?)\s*",
    # ... (excitation, neb_energy, md_step, vib_freq, fermi_energy)
}
```

> **단독 개발 시 목업 전략**: `app/shared/physics_patterns.py` 전체를 띄우기 무겁다면, `PHYSICS_PATTERNS` dict만 담은 stub `app/shared/physics_patterns.py`를 두면 `app/features/report/service.py`는 그대로 동작한다. 마찬가지로 `app/features/report/prompts.py`에 `REPORT_PROMPT = "...{context}..."`, `COMPARATIVE_REPORT_PROMPT = "...{context}..."` 두 상수만 stub으로 두면 된다.

---

## 외부 의존성

| 종류 | 이름 | 설명 / 기본값 |
| :--- | :--- | :--- |
| **환경변수** | `CLAUDE_API_KEY` | **필수.** `AsyncAnthropic(api_key=os.getenv('CLAUDE_API_KEY'), timeout=60.0)`. 없으면 LLM 호출 실패 → 폴백 템플릿으로 동작(앱은 죽지 않음). |
| **환경변수** | `ANTHROPIC_MODEL` | 선택. 기본 `"claude-sonnet-4-6"`. |
| **외부 API** | Anthropic Claude (Messages API) | `client.messages.create(...)`. 호출 컨텍스트별 토큰: `ai_semantic_extract`=`max_tokens=200, temperature=0.0, system="strict JSON data extractor"`; 단일 리포트=`max_tokens=1500`; 다중 리포트=`max_tokens=4000`. |
| **파일시스템** | `<root>/simulations/{job_dir}/` | `root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))` (`app/features/report/service.py` 두 단계 상위). 하위의 `.out`(`-r-`/`BAND` 제외)/`.pdos`/`.bs`/`multi_metadata.json`을 읽음. |
| **단위 변환 상수** | a.u. → eV | `× 27.2114` (`parse_pdos_file`, work_function Fermi 변환 등). |
| **단위 변환 상수** | E(eV) → λ(nm) | `1239.84 / E` (absorption/emission 파장 계산). |
| **SGE / qsub** | 없음 | **이 기능은 잡 스케줄러에 의존하지 않는다.** 계산 결과 파일만 읽는다. (제출/실행은 `f4` 소유) |

---

## 병렬 개발 가이드

### 무엇을 목업하면 단독 개발이 가능한가

이 기능은 `f4`의 **코드가 아니라 디스크 산출물**에만 의존하므로, `f4` 미완성 상태에서도 100% 단독 개발 가능하다.

1. **디스크 픽스처 생성** — `simulations/MOCK_JOB/step1/cp2k.out`에 위 [`.out` 목업](#1-simulationartifacts--f4-jobs--data-modelsmdsimulationartifacts) 배치. 반드시 `PROGRAM ENDED` 줄 포함.
   - dos/band 테스트 시 같은 폴더에 `.pdos` / `.bs` 추가.
   - 다중 테스트 시 parent 폴더에 `multi_metadata.json` + `safe_name` 하위 폴더별 `.out`.
2. **공유 모듈 stub** — `app/shared/physics_patterns.py`에 `PHYSICS_PATTERNS` dict만, `app/features/report/prompts.py`에 `REPORT_PROMPT`/`COMPARATIVE_REPORT_PROMPT` 두 상수만 두면 import 충족.
3. **Anthropic 목업** — `CLAUDE_API_KEY` 미설정 시 LLM 호출이 자연스럽게 예외→폴백 템플릿으로 떨어지므로, **정규식 추출 경로와 폴백 리포트 경로는 API 키 없이 테스트 가능**하다. AI 폴백(`ai_semantic_extract`) 경로만 키가 필요하다 — `AsyncAnthropic.messages.create`를 mock으로 패치해 `{"final_energy": "...", "target_property": "..."}` JSON을 반환시키면 키 없이도 검증된다.
4. **상위 키 결합** — 통합 시 `SubmitJobResponse.directory` 문자열만 받아 `ReportRequest.job_dir`로 넣으면 끝. `JobStatus`는 절대 참조하지 말 것(경계 위반).

### 완료 정의 (Definition of Done)

- [ ] `POST /generate-report`가 `ReportRequest`(job_dir/property/lang)를 받아 `ReportData`를 반환한다.
- [ ] 단일 분기: `summary = {final_energy, target_property}`, 12종 물성 각각에 대해 정규식 추출이 동작(샘플 `.out` 픽스처로 검증).
- [ ] `.out`에서 못 찾고 `PROGRAM ENDED`가 있을 때만 AI 폴백 호출 + **Zero-Hallucination 크로스체크**(추출값이 원본 본문에 실제 존재하는지 확인, 없으면 `N/A` 기각).
- [ ] dos/band: 주 `.out`에 gap/fermi 없으면 `.pdos`(우선) → `.bs`(차선) 보조 파싱, a.u.→eV(×27.2114) 변환 검증.
- [ ] 다중 분기: `multi_metadata.json` 존재 시 `is_multi:true`, `summary`가 `{filename: {energy, target_property}}` 맵, `safe_name` 우선 / `job_key` 폴백 경로 해석.
- [ ] `lang="en"` 시 리포트/폴백/에러 메시지 전부 영문.
- [ ] LLM 예외 시에도 폴백 템플릿 마크다운으로 `200` 반환(앱이 죽지 않음).
- [ ] 에러 케이스(디렉토리 없음/데이터 없음)에서 `status`/HTTP 코드가 정상과 구분된다 (**clean 목표** — 현재 `app/features/report/router.py`가 `status:"success"`를 덧씌우는 버그를 수정).
- [ ] `app/features/jobs/service.py` / `JobStatus` import·참조가 코드에 전혀 없음을 확인(경계 검증).
