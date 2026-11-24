Browser playthrough used during development (needs Node + Playwright).
Run from the project root with the server running and demo data reset:
    python manage.py seed_demo --reset
    node tools/ui_tests/game_test.js student_demo guided
It plays a full adventure through the real game (walking, machines, gates, escape), saves screenshots in ui_shots/, and prints any console errors.
