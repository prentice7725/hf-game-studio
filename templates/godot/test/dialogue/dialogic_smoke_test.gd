extends GdUnitTestSuite
## dialogue/*.dtl(대사 JSON의 변환물)을 Dialogic 2가 읽어 이벤트로 만드는지 본다.
## Dialogic 클래스를 직접 쓰면 애드온이 없을 때 이 파일 전체가 파싱 오류가 나므로 스크립트를 동적으로 load한다.

const TIMELINE_SCRIPT := "res://addons/dialogic/Resources/timeline.gd"


func test_every_dtl_parses() -> void:
	if not FileAccess.file_exists(TIMELINE_SCRIPT):
		print("Dialogic 애드온 없음: 건너뜀 (tools/hfgs/godot-addons.mjs)")
		return
	var timeline_script: GDScript = load(TIMELINE_SCRIPT)
	var files := DirAccess.get_files_at("res://dialogue")
	var count := 0
	for f in files:
		if not f.ends_with(".dtl"):
			continue
		var text := FileAccess.get_file_as_string("res://dialogue/" + f)
		var timeline: Resource = timeline_script.new()
		timeline.from_text(text)
		timeline.process()
		assert_int(timeline.events.size()).override_failure_message("%s: 이벤트가 없음" % f).is_greater(0)
		count += 1
	print("Dialogic 타임라인 %d개 파싱" % count)
