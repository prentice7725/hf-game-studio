class_name ContractRules
## GDD "수치와 공식"의 contract_success_chance. 웹 프로토타입(prototype/src/rules/contract.ts)과 같은 식이어야 한다.
## GDD가 TBD인 동안의 기본식이다: 검사 능력치가 (난이도 + 2)와 같으면 50%, 1 차이마다 10%씩, 5%~95%로 자른다.
## GDD가 정해지면 이 함수 하나만 바꾼다. 장면 코드는 부르기만 한다.

const MIN_CHANCE := 0.05
const MAX_CHANCE := 0.95


static func success_chance(merc: Dictionary, contract: Dictionary) -> float:
	var stat_name: String = str(contract.get("check", ""))
	var stats: Dictionary = merc.get("stats", {})
	var stat: float = float(stats.get(stat_name, 0))
	var raw := 0.5 + (stat - (float(contract.get("difficulty", 0)) + 2.0)) * 0.1
	return clampf(snappedf(raw, 0.01), MIN_CHANCE, MAX_CHANCE)


## roll은 [0, 1) 난수. 분리해 두어 테스트에서 난수를 고정할 수 있다.
static func resolve(chance: float, roll: float) -> String:
	assert(roll >= 0.0 and roll < 1.0, "roll must be in [0, 1)")
	return "success" if roll < chance else "failure"


static func percent(chance: float) -> String:
	return "%d%%" % int(round(chance * 100.0))
