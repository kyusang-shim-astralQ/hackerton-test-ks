# 04 · f3-inp — 4단계(AI 플랜 검토/편집 + INP 생성)

> 사용법: `01-foundation.md`(+ 가급적 f2까지) 완료 후, 새/같은 세션에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 **f3-inp** 기능(4단계: AI가 제안한 멀티스텝 플랜 검토·편집 후 CP2K `.inp` 생성)을 `frontend-next`에 구현하고 백엔드에 연결한다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f3-inp/api.md` — `POST /generate-inp`의 요청/응답 계약(`InpRequest` → `{status, generated_files:[{filename, content}]}`). 스텝 필터링(selected/exclude)·단일/다중 분기·파일명 규칙·k-point 3단계 우선순위를 그대로 따른다.
- `docs/contracts/data-models.md` — `InpRequest`, `PlanStep`, `GeneratedFile`, `GenerateInpResult` 필드.
- `docs/design-system.md` §4.2(4단계) + `docs/mockups/a-paper-hifi.html`.

### 만들 것 (`app/(wizard)/step-4`)
1. **AI 워크플로 검토**: wizard-store의 `steps[]`(f2 결과)를 가변 N-스텝 타임라인/체크리스트로 표시. 각 스텝 **제외 토글**(selected/exclude), run_type·소요·core·h 등 요약, 💡전문가 팁(expert_tip) 인라인. 합계(시간/core·h) 집계.
2. **INP 생성**: [최종 INP/SGE 생성] → `POST /generate-inp`(body=store의 atom_info/steps(+exclude 반영)/옵션로 조립한 `InpRequest`). 응답 `generated_files[]`를 store에 저장.
3. **INP 미리보기**(선택): 생성된 `.inp` 텍스트를 모노 코드 뷰어로 표시(스텝 클릭 시 해당 파일 강조). 성공 시 [다음/제출] → step-5.

### 연결/상태
- 실제 백엔드(:8000)로 동작(결정론적, 클러스터 불필요, 로컬 완전 작동). `NEXT_PUBLIC_MOCK=1`이면 `GenerateInpResult` 형태 목으로 대체.
- f2가 아직 없으면 `data-models.md` `PlanStep` 목업(예: GeomOpt/SCF/Band/DOS)으로 store를 시드해 단독 개발 가능.

### 완료 정의 (DoD)
- [ ] `steps[]`가 편집 가능한 타임라인으로 표시, 제외 토글이 요청에 반영.
- [ ] [생성]이 실제 `/generate-inp`(또는 목)으로 `generated_files[{filename,content}]`를 받아 store에 저장.
- [ ] 응답이 `GenerateInpResult` 계약과 일치(부분 실패 없음, 예외 시 에러 표시).
- [ ] 디자인 일치, 이모지 없음.
