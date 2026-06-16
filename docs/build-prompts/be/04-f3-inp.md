# be/04 · f3-inp 백엔드 (🟡 SIMPLE · 템플릿)

> `be/01-foundation.md` 완료 후 실행.

---

## 프롬프트

너는 백엔드 **f3-inp** 기능을 from-scratch로 구현한다. MVP에서는 34MB 스키마 엔진 대신 **문자열 템플릿**으로 CP2K `.inp`를 생성한다(완전 검증은 범위 밖).

### 먼저 읽어라
- `docs/features/f3-inp/api.md` — `POST /generate-inp` 계약(`InpRequest` → `{status, generated_files:[{filename, content}]}`). 스텝 필터(selected/exclude)·파일명 규칙을 따른다.
- `docs/contracts/data-models.md` — `InpRequest`/`PlanStep`/`GeneratedFile`.
- `docs/build-prompts/MVP-SCOPE.md`(🟡 템플릿).

### 구현 (`backend/app/features/inp/` + `app/shared/inp_template.py`)
- **shared/inp_template.py**: `PlanStep` + atom_info + params로 **유효한 CP2K `.inp` 텍스트**를 만든다. 핵심은 **고정 템플릿이 아니라 "기본 구조 + 플랜 옵션 병합"**(schema_engine 없이 충실도 확보):
  1. **기본 구조(중첩 dict)**: `&GLOBAL`(PROJECT/RUN_TYPE), `&FORCE_EVAL`(METHOD QS, `&DFT`(BASIS_SET/POTENTIAL, `&MGRID` CUTOFF/REL_CUTOFF, `&XC` FUNCTIONAL, `&SCF` EPS_SCF/MAX_SCF/알고리즘)), `&SUBSYS`. RUN_TYPE별 `&MOTION` 등 분기.
  2. **좌표·셀은 atom_info에서**(CLAUDE §5): `&SUBSYS`의 `&CELL`(`full_cell_text`/`cell`)·`&COORD`(`full_coord_text`)·`&KIND`(elements)는 **ASE 파싱값**으로 채운다(LLM이 좌표를 지어내지 않게).
  3. **플랜 옵션 병합 (★ 충실도 핵심)**: `parse_path_based_options(step.inp_options)` — 경로형 문자열(`"FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6"`)을 중첩 dict로 파싱 → 기본 구조에 **deep-merge**. = AI가 설계한 옵션(과 self-healing의 FIX)이 해당 `&SECTION`에 **실제로 반영**됨.
  4. **렌더**: 중첩 dict를 재귀적으로 `&SECTION … &END`로 출력. `parse_path_based_options`와 이 렌더러는 `app/shared/`에 두어 **f4 자가치유(be/05)가 동일하게 재사용**(FIX도 같은 경로형).
- **service.py**: `generate_inp_logic` — selected/exclude 필터 후 1-based 재인덱싱 → 스텝별 `inp_template`로 `.inp` 생성. 단일/다중(`multi_atom_info`) 분기·파일명(`step{i}.inp` / `{base}_step{i}.inp`)은 api.md대로. **다중-CIF면** `multi_atom_info`의 **구조별 × 스텝별**로 `.inp`를 모두 생성하고 파일명에 구조 base를 반영(`{base}_step{i}.inp`).
- **router.py**: `POST /generate-inp` → `GenerateInpResult{status:"success", generated_files:[{filename,content}]}`.

### 완료 정의 (DoD)
- [ ] `steps[]` → 그럴듯하고 구문상 유효한 `.inp` 텍스트가 생성된다.
- [ ] 스텝의 `inp_options`(경로형)가 `.inp`의 해당 `&SECTION`에 **실제 반영**된다(고정 템플릿이 아니라 플랜 옵션 deep-merge). `&COORD`/`&CELL`/`&KIND`는 atom_info(ASE) 값에서 온다.
- [ ] 응답이 `GenerateInpResult` 계약 형태와 일치(프런트가 미리보기/제출에 사용).
- [ ] 다중-CIF(`multi_atom_info`) 시 구조별 × 스텝별 `.inp`가 모두 생성되고 파일명이 구조 base로 구분된다.
- [ ] 스텝 필터·파일명·다중 분기 규칙 준수. (완전 스키마 검증은 MVP 밖임을 코드 주석으로 명시.)
