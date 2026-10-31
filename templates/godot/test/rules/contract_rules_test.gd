extends GdUnitTestSuite
## ContractRules 테스트. 프로토타입의 contract.test.ts와 같은 경우를 본다. 두 쪽 결과가 다르면 공식이 어긋난 것이다.


func merc(might: int) -> Dictionary:
	return {"id": "ash", "name": "애쉬", "hire_cost": 100, "stats": {"might": might, "wits": 5, "grit": 5}}


func contract(difficulty: int) -> Dictionary:
	return {"id": "c", "title": "계약", "difficulty": difficulty, "reward": 10, "days": 3, "check": "might"}


func test_equal_stat_is_half() -> void:
	assert_float(ContractRules.success_chance(merc(5), contract(3))).is_equal_approx(0.5, 0.001)


func test_ten_percent_per_point() -> void:
	assert_float(ContractRules.success_chance(merc(6), contract(3))).is_equal_approx(0.6, 0.001)
	assert_float(ContractRules.success_chance(merc(3), contract(3))).is_equal_approx(0.3, 0.001)


func test_clamped() -> void:
	assert_float(ContractRules.success_chance(merc(1), contract(5))).is_equal_approx(ContractRules.MIN_CHANCE, 0.001)
	assert_float(ContractRules.success_chance(merc(10), contract(1))).is_equal_approx(ContractRules.MAX_CHANCE, 0.001)


func test_resolve() -> void:
	assert_str(ContractRules.resolve(0.5, 0.49)).is_equal("success")
	assert_str(ContractRules.resolve(0.5, 0.5)).is_equal("failure")


func test_percent() -> void:
	assert_str(ContractRules.percent(0.456)).is_equal("46%")
