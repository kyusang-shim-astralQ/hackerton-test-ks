# 구조 분석 (Structure Analysis)

## 구현 위치 (폴더 구조)

이 기능은 `app/features/structure/` 아래에 구현된다: HTTP 라우트는 `app/features/structure/router.py`, CIF 파싱 로직은 `app/features/structure/service.py`, 기능 전용 요청 모델은 `app/features/structure/schemas.py`. cross-feature 모델(`AtomInfo`, `AnalyzeCifResponse` 등)은 `app/schemas/common.py`에 있고, 공유 엔진(self-healing, physics-rules, schema-engine 등)은 `app/shared/*`에 위치한다. 앱 부트스트랩(라우터 등록/미들웨어/정적 서빙)은 `app/main.py`가 담당한다.

> **한 줄 책임:** 업로드된 CIF 파일(bytes)을 ASE로 파싱하여 파이프라인의 단일 진실 소스(SSOT)인 정규화된 `atom_info`(원자/격자/원소 + SMEAR 권장값)를 생산하고, CIF 본문 SHA-256 해시(`content_hash`)를 함께 반환한다.

| 항목 | 내용 |
| --- | --- |
| **feature id** | `f1-structure` |
| **담당 모듈** | `app/features/structure/service.py` (CIF 파싱), `app/features/structure/router.py` (HTTP 라우트) |
| **엔드포인트** | `POST /analyze-cif` |
| **소유 범위** | CIF 파싱 로직, `atom_info` dict 스키마 |
| **비소유 범위** | LLM 플랜 생성(f2), .inp 렌더링(f3), 작업 제출/모니터링(f4), 리포트(f5), 벤치마크(f6) |

### 핵심 설계 원칙 (clean 목표)

- `atom_info`는 파이프라인 전체가 의존하는 **SSOT**다. f1이 정의한 키 집합이 곧 모든 하위 기능의 입력 계약이다.
- **f1은 순수 파싱 진입점이다.** 업로드된 CIF를 `atom_info`로 변환하고 `content_hash`를 반환하는 것이 전부이며, 디스크에 영속 상태를 쓰지 않는다.

---

## HTTP API 명세

### 1) `POST /analyze-cif`

업로드된 CIF 파일을 파싱하여 `atom_info`와 `content_hash`를 반환한다.

- **Method / Path:** `POST /analyze-cif`
- **Content-Type:** `multipart/form-data`
- **Body:** 단일 파일 필드

| 필드명 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `file` | `UploadFile` (multipart) | ✅ | 업로드할 CIF 파일. 파일명은 반드시 `.cif`로 끝나야 한다(아니면 400). 본문은 bytes로 읽혀 ASE에 전달된다. |

#### 응답 JSON 스키마 (`AnalyzeCifResponse`)

> 표준 데이터 계약 `AnalyzeCifResponse`. `data-models.md` 참조.

| 필드명 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `status` | `str` | ✅ | 성공 시 항상 `"success"` |
| `filename` | `str` | ✅ | 업로드 파일명 |
| `atom_info` | `AtomInfo` | ✅ | 분석된 구조 정보(아래 `AtomInfo` 계약). 정상/parse-failure 폴백/empty-CIF 폴백 세 형태 중 하나 |
| `content_hash` | `str` | ✅ | CIF 본문 SHA-256 hex(64자) |

#### 요청 예시

```bash
curl -X POST http://localhost:8000/analyze-cif \
  -F "file=@Si.cif"
```

#### 응답 예시 (정상 경로)

```json
{
  "status": "success",
  "filename": "Si.cif",
  "atom_info": {
    "filename": "Si.cif",
    "atom_count": 8,
    "atoms": [
      { "element": "Si", "x": 0.0, "y": 0.0, "z": 0.0 },
      { "element": "Si", "x": 1.3575, "y": 1.3575, "z": 1.3575 }
    ],
    "elements": ["Si"],
    "element_counts": { "Si": 8 },
    "element_indices": { "Si": [1, 2, 3, 4, 5, 6, 7, 8] },
    "cell": [5.43, 5.43, 5.43],
    "cell_angles": [90.0, 90.0, 90.0],
    "volume": 160.103,
    "full_coord_text": "      Si    0.00000000    0.00000000    0.00000000\n      Si    1.35750000    1.35750000    1.35750000",
    "full_cell_text": "      ABC   5.43000000   5.43000000   5.43000000\n      ALPHA_BETA_GAMMA  90.00000000  90.00000000  90.00000000",
    "use_scaled": false,
    "smear_recommended": false,
    "smear_reason_ko": "유기 분자 또는 일반 비금속 구조로 판단되어 SMEAR 비활성화가 권장됩니다. (수렴 실패 시에만 활성화 권장)",
    "smear_reason_en": "Organic or non-metal structure detected. Smearing is not recommended by default (enable only if SCF convergence fails)."
  },
  "content_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

#### 상태코드 / 에러

| 코드 | 조건 | 응답 |
| --- | --- | --- |
| `200` | 정상 처리(정상 파싱 + 두 폴백 모두 200) | `AnalyzeCifResponse` |
| `400` | 파일명이 `.cif`로 끝나지 않음 | `{ "detail": "Only .cif files are allowed." }` |
| `422` | `file` 필드 누락(FastAPI 검증) | `{ "detail": [...] }` |
| `500` | 라우트 처리 중 예외(읽기/해싱 실패 등) | `{ "detail": "Error parsing CIF: <msg>" }` |

> **중요:** ASE 파싱 실패나 원자 0개는 500이 **아니다.** `app/features/structure/service.py`가 내부에서 잡아 `error` 키가 포함된 폴백 `atom_info`(200)로 반환한다. 소비자는 HTTP 코드가 아니라 `atom_info.atom_count == 0` / `atom_info.error` 유무로 방어해야 한다.

---

## 생산하는 데이터 계약

이 기능이 내보내 하위 기능들이 소비하는 구조다. 정의 상세는 `data-models.md`의 동명 계약 참조.

### `AtomInfo` — 파이프라인 SSOT

`data-models.md` → [`AtomInfo`](../../data-models.md#atominfo)

- **생산자:** `f1-structure` (유일)
- **소비자:** `f2-plan`, `f3-inp`, `f4-jobs`, `f6-benchmark`
- **형태가 3가지다 (소비자 방어 필수):**

| 형태 | 발생 조건 | 특징 |
| --- | --- | --- |
| **정상(success)** | ASE 파싱 성공 & 원자 ≥ 1 | 모든 키 존재(`cell_angles`/`smear_*` 포함) |
| **parse-failure 폴백** | `ase.io.read` 예외 | `atom_count=0`, `error=str(e)`. `element_indices={}`, `volume`(a·b·c 단순곱) 존재. `cell_angles`/`smear_*` **부재** |
| **empty-CIF 폴백** | 파싱 성공이나 원자 0개 | `atom_count=0`, `error="Empty CIF (No atoms)"`. `element_indices`/`volume`/`cell_angles`/`smear_*` **모두 부재** |

> **계약 규칙:** 세 형태의 키 집합이 서로 다르다. 선택적 키(`cell_angles`, `volume`, `element_indices`, `smear_*`, `error` 등)는 **반드시 `.get()`으로 읽을 것.** 세 형태 모두에 존재하는 키는 `filename`, `atom_count`, `atoms`, `elements`, `element_counts`, `cell`, `full_coord_text`, `full_cell_text`, `use_scaled` 뿐이다.

#### 전 형태 공통 키 (안전하게 직접 접근 가능)

| key | type | 정상 | parse-failure | empty-CIF | notes |
| --- | --- | :-: | :-: | :-: | --- |
| `filename` | `str` | ✅ | ✅ | ✅ | 입력 파일명 그대로 |
| `atom_count` | `int` | ✅ | ✅(0) | ✅(0) | 원자 수 |
| `atoms` | `List[{element,x,y,z}]` | ✅ | ✅(`[]`) | ✅(`[]`) | 원자별 좌표 |
| `elements` | `List[str]` | ✅ | ✅(`[]`) | ✅(`[]`) | 등장 원소 |
| `element_counts` | `Dict[str,int]` | ✅ | ✅(`{}`) | ✅(`{}`) | 원소별 개수 |
| `cell` | `List[float]` 길이3 | ✅ | ✅ | ✅ | `[a,b,c]`. 폴백은 CIF 태그 추출 또는 10.0 |
| `full_coord_text` | `str` | ✅ | ✅(`""`) | ✅(`""`) | CP2K COORD 텍스트 |
| `full_cell_text` | `str` | ✅ | ✅ | ✅ | ABC + ALPHA_BETA_GAMMA(폴백은 포맷 정밀도 없음) |
| `use_scaled` | `bool` | ✅ | ✅(False) | ✅(False) | SCALED 모드 제안 |

#### 선택적 키 (`.get` 필수)

| key | type | 존재 형태 | notes |
| --- | --- | --- | --- |
| `element_indices` | `Dict[str,List[int]]` | 정상, parse-failure(`{}`) | 1-based 인덱스. empty-CIF 부재 |
| `cell_angles` | `List[float]` 길이3 | 정상만 | `[alpha,beta,gamma]` 도. 부재 시 소비자가 90도 기본 처리 |
| `volume` | `float` | 정상, parse-failure | empty-CIF 부재 |
| `smear_recommended` | `bool` | 정상만 | SMEAR 권장 여부 |
| `smear_reason_ko` | `str` | 정상만 | SMEAR 사유(한국어) |
| `smear_reason_en` | `str` | 정상만 | SMEAR 사유(영어). `app/features/inp/service.py`가 읽음 |
| `periodic` | `str` | (f1 미생산) | 선택적. 없으면 `app/features/inp/service.py`가 `"XYZ"` fallback |
| `error` | `str` | 폴백 2종만 | 예외 메시지(parse-failure=`str(e)`, empty-CIF=`"Empty CIF (No atoms)"`) |

### `AnalyzeCifResponse`

`data-models.md` → [`AnalyzeCifResponse`](../../data-models.md#analyzecifresponse) — `POST /analyze-cif`의 응답 전체. 소비자: `f2-plan`, `f3-inp`, `f4-jobs`(프런트엔드 경유).

---

## 소비하는 데이터 계약

**없음.** `f1-structure`는 파이프라인의 진입점이며 상위 기능의 출력을 소비하지 않는다(`consumes: []`).

유일한 외부 입력은 **사용자가 업로드하는 CIF 파일(raw bytes)** 이며, 이는 데이터 계약이 아니라 multipart 파일이다. 따라서 상위 기능을 목업할 필요 없이 **즉시 단독 개발을 시작할 수 있다.**

> 단독 개발용 입력 목업: 아무 CIF 텍스트 파일이면 충분하다. 최소 예시(실리콘):
>
> ```cif
> data_Si
> _cell_length_a 5.43
> _cell_length_b 5.43
> _cell_length_c 5.43
> _cell_angle_alpha 90.0
> _cell_angle_beta 90.0
> _cell_angle_gamma 90.0
> _symmetry_space_group_name_H-M 'F d -3 m'
> loop_
> _atom_site_label
> _atom_site_fract_x
> _atom_site_fract_y
> _atom_site_fract_z
> Si 0.0 0.0 0.0
> ```
>
> 폴백 경로 테스트용 목업: 빈 파일(원자 0개 → empty-CIF 폴백), 깨진 CIF(파싱 예외 → parse-failure 폴백).

---

## 내부·공유 의존성

### 공유 모듈 — `app/features/structure/service.py` 의 `analyze_cif_structure`

```python
from app.features.structure.service import analyze_cif_structure

# signature
analyze_cif_structure(content: bytes, filename: str) -> dict  # -> AtomInfo
```

- **호출자:** `app/features/structure/router.py`의 `/analyze-cif` 라우트, 그리고 `app/features/benchmark/service.py`(f6).
- **동작:** `ase.io.read(BytesIO(content), format="cif")`로 파싱 → 정규화된 `atom_info` 반환. 순수 in-memory 함수(디스크 I/O 없음). 예외/원자 0개는 내부에서 폴백 dict로 흡수한다.
- **계약 안정성:** 이 함수의 반환 dict 키 집합 = `AtomInfo` 계약. f1은 이 키를 함부로 바꾸면 안 된다(SSOT).

### 공유 모듈 — `content_hash` 계산

- **`/analyze-cif`에서의 해시 계산:** CIF 본문(bytes)을 SHA-256으로 해싱해 응답 `content_hash`(64자 hex)를 만든다. content가 falsy면 `""`, bytes는 그대로, str은 utf-8 인코딩 후 해싱한다. 디스크에 영속 상태를 쓰지 않는 순수 계산이다.

---

## 외부 의존성

| 의존성 | 이 기능에서의 사용 여부 | 상세 |
| --- | --- | --- |
| **ASE** (`ase.io.read`, `format="cif"`) | ✅ 필수 | `app/features/structure/service.py`가 CIF 파싱에 사용. `pip install ase`. `get_cell().lengths()/angles()`, `get_chemical_symbols()`, `get_volume()`, `atom.position/symbol` 사용 |
| **파일시스템** | ❌ 미사용 | f1은 디스크에 영속 상태를 쓰지 않는다. CIF는 메모리(bytes)로만 처리 |
| **Anthropic API 키** | ❌ 미사용 | `app/features/structure/service.py`는 LLM을 호출하지 않는다(Anthropic 클라이언트는 `app/core/llm.py`). `.env`의 `ANTHROPIC_API_KEY`는 다른 기능(f2/f4/f5/f6)이 사용하며 f1과 무관 |
| **SGE / qsub** | ❌ 미사용 | 작업 제출은 f4의 책임(`app/features/jobs/service.py` + `app/core/sge.py`). f1은 스케줄러를 호출하지 않음 |
| **환경변수** | ❌ 직접 의존 없음 | `app/main.py`가 부팅 시 `load_dotenv()`로 `.env`를 로드하지만, f1 모듈 자체가 읽는 환경변수는 없음 |
| **네트워크** | ❌ 없음 | 전부 로컬 처리 |

> **결론:** 이 기능은 외부 API 키나 클러스터 없이 **로컬에서 완전히 실행/테스트 가능하다.** 필요한 것은 Python + ASE + 쓰기 가능한 작업 디렉터리뿐이다.

---

## 병렬 개발 가이드

### 무엇을 목업하면 단독 개발이 가능한가

이 기능은 **소비하는 상위 계약이 없으므로 목업이 거의 필요 없다.** 진입점 기능이라 가장 먼저, 가장 독립적으로 개발할 수 있다.

| 영역 | 목업/대체 방법 |
| --- | --- |
| **입력 (CIF)** | 실제 CIF 텍스트 파일이면 충분(위 [소비하는 데이터 계약](#소비하는-데이터-계약)의 목업 CIF 사용). 정상/빈/깨진 3종을 준비해 세 폴백 경로를 모두 커버 |
| **하위 소비자 (f2~f6)** | 목업 불필요. f1은 이들을 호출하지 않는다. 내가 생산한 `atom_info` JSON을 그대로 떠서 그들에게 넘기면 됨 |
| **프런트엔드 연동** | 계약(`AnalyzeCifResponse`)만 지키면 됨. 프런트 없이 `curl`/pytest로 검증 가능 |

### 단독 검증 시나리오

```bash
# 1. 정상 파싱
curl -X POST http://localhost:8000/analyze-cif -F "file=@Si.cif"
#    기대: 200, atom_count>0, cell_angles/smear_* 존재, content_hash 64자

# 2. 비-CIF 거부
curl -X POST http://localhost:8000/analyze-cif -F "file=@notes.txt"
#    기대: 400 "Only .cif files are allowed."

# 3. 폴백 경로
#    빈 CIF → atom_count=0, error="Empty CIF (No atoms)", cell_angles 부재
#    깨진 CIF → atom_count=0, error=str(e)
```

### 완료 정의 (Definition of Done)

- [ ] `analyze_cif_structure(content, filename)`가 정상 CIF에 대해 **공통 키 9종 + 정상 전용 키(`cell_angles`, `volume`, `element_indices`, `smear_recommended`, `smear_reason_ko/en`)** 를 모두 채운 `atom_info`를 반환한다.
- [ ] parse-failure 폴백과 empty-CIF 폴백이 **각각 명세된 키 집합대로** (`error` 메시지 포함) 반환된다. 두 폴백의 키 차이(`element_indices`/`volume` 유무)가 정확하다.
- [ ] `POST /analyze-cif`가 `.cif`가 아닌 파일에 400, 정상/폴백 모두 200, `content_hash`(64자 hex)를 반환한다.
- [ ] `content_hash`가 **CIF 본문(bytes) SHA-256**임을 보장한다(파일명 변경/재업로드에 무관, 본문이 같으면 같은 해시).
- [ ] `atom_info` 키 집합을 변경하지 않았다(SSOT 안정성). 변경이 불가피하면 `data-models.md`의 `AtomInfo` 계약을 함께 갱신하고 소비 기능(f2/f3/f4/f6)에 통지한다.
- [ ] ASE 외 외부 API/클러스터 없이 로컬에서 위 3개 시나리오가 통과한다.
