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
- **shared/inp_template.py**: `PlanStep` + atom_info + params로 **유효한 CP2K `.inp` 텍스트**를 만드는 템플릿 함수. 최소 유효 블록: `&GLOBAL`(PROJECT/RUN_TYPE), `&FORCE_EVAL`(METHOD QS, `&DFT`(BASIS/POTENTIAL, `&MGRID` CUTOFF, `&XC` FUNCTIONAL, `&SCF` EPS_SCF/MAX_SCF)), `&SUBSYS`(`&CELL` ABC/ANGLES, `&COORD`, `&KIND`). RUN_TYPE에 따라 `&MOTION` 등 분기.
- **service.py**: `generate_inp_logic` — selected/exclude 필터 후 1-based 재인덱싱 → 스텝별 `inp_template`로 `.inp` 생성. 단일/다중(`multi_atom_info`) 분기·파일명(`step{i}.inp` / `{base}_step{i}.inp`)은 api.md대로. **다중-CIF면** `multi_atom_info`의 **구조별 × 스텝별**로 `.inp`를 모두 생성하고 파일명에 구조 base를 반영(`{base}_step{i}.inp`).
- **router.py**: `POST /generate-inp` → `GenerateInpResult{status:"success", generated_files:[{filename,content}]}`.

### 완료 정의 (DoD)
- [ ] `steps[]` → 그럴듯하고 구문상 유효한 `.inp` 텍스트가 생성된다.
- [ ] 응답이 `GenerateInpResult` 계약 형태와 일치(프런트가 미리보기/제출에 사용).
- [ ] 다중-CIF(`multi_atom_info`) 시 구조별 × 스텝별 `.inp`가 모두 생성되고 파일명이 구조 base로 구분된다.
- [ ] 스텝 필터·파일명·다중 분기 규칙 준수. (완전 스키마 검증은 MVP 밖임을 코드 주석으로 명시.)
