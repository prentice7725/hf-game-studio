extends Control
## 시작 장면. data/*.json을 읽어 계약 게시판을 글자로 보여 준다.
## 규칙 계산은 ContractRules, 데이터 읽기는 DataLoader에 두고 여기서는 부르기만 한다(프로토타입과 같은 분리).

func _ready() -> void:
	var mercs: Array = DataLoader.mercenaries()
	var contracts: Array = DataLoader.contracts()
	var merc: Dictionary = mercs[0] if mercs.size() > 0 else {}
	var box := VBoxContainer.new()
	box.position = Vector2(40, 40)
	add_child(box)
	_label(box, "계약 게시판", 36)
	_label(box, "용병: %s" % merc.get("name", "없음"), 24)
	for c: Dictionary in contracts:
		var chance := ContractRules.success_chance(merc, c) if not merc.is_empty() else -1.0
		var line := "%s  난이도 %d · 보수 %d · %d일 · %s" % [c.get("title", "?"), int(c.get("difficulty", 0)), int(c.get("reward", 0)), int(c.get("days", 0)), str(c.get("check", ""))]
		if chance >= 0.0:
			line += "  성공 %s" % ContractRules.percent(chance)
		_label(box, line, 22)
	if contracts.is_empty():
		_label(box, "계약 데이터 없음 (data/contracts.json)", 22)
	# 헤드리스 부팅 검사(godot-check.mjs run)가 로그에서 확인하는 표식.
	print("HFGS_READY mercenaries=%d contracts=%d" % [mercs.size(), contracts.size()])


func _label(parent: Node, text: String, size: int) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	parent.add_child(l)
