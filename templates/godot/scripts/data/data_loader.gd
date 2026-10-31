class_name DataLoader
## data/*.json을 읽는다. 웹 프로토타입과 같은 파일이고 형식은 design/schemas/*.schema.json이다.
## 수치·문구·대사는 여기서 읽고 코드에 복사하지 않는다.

const DATA_DIR := "res://data"


static func load_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		push_warning("데이터 파일 없음: %s" % path)
		return null
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if parsed == null:
		push_error("JSON을 읽을 수 없음: %s" % path)
	return parsed


static func mercenaries() -> Array:
	var doc: Variant = load_json(DATA_DIR + "/mercenaries.json")
	return doc.get("mercenaries", []) if doc is Dictionary else []


static func contracts() -> Array:
	var doc: Variant = load_json(DATA_DIR + "/contracts.json")
	return doc.get("contracts", []) if doc is Dictionary else []


static func dialogue(id: String) -> Dictionary:
	var doc: Variant = load_json("%s/dialogue/%s.json" % [DATA_DIR, id])
	return doc if doc is Dictionary else {}
