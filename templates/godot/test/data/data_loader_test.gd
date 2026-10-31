extends GdUnitTestSuite
## 데이터 파일이 있으면 읽히는지, 없으면 빈 값으로 조용히 넘어가는지 본다.


func test_missing_file_returns_null() -> void:
	assert_that(DataLoader.load_json("res://data/does-not-exist.json")).is_null()


func test_contracts_when_present() -> void:
	if not FileAccess.file_exists("res://data/contracts.json"):
		print("data/contracts.json 없음: 건너뜀")
		return
	var contracts := DataLoader.contracts()
	assert_int(contracts.size()).is_greater(0)
	for c: Dictionary in contracts:
		assert_that(c.has("title") and c.has("difficulty") and c.has("check")).is_true()
