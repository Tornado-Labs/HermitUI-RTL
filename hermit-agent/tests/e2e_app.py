"""Real-model application task: build a small multi-file app (a library-loans package,
a CLI, its own unit tests and a README) from a written spec, checked by hidden tests the
model never sees. It is the one long task: 10 to 20 steps and a dozen files, where the
reference and coding suites mostly take 3 to 7 steps, so it is where a plan (Phase 3.7),
compaction and the per-turn cost of a protocol show. It runs through e2e_reference.py's
runner, so the flags and results file are the same:

    ../benchmark/.venv/bin/python tests/e2e_app.py --base-url http://localhost:9931/v1 [--runs 3] [--tool-mode native|text]
    ../benchmark/.venv/bin/python tests/e2e_app.py --context-size 20000   # compacts mid-task

Results go to tests/results/app-<time>.json.
"""
from e2e_reference import main

PROMPT = """Build a small library-loans application in /workspace, following this spec exactly.

Package library/ (with __init__.py):
- library/models.py: dataclasses Book(isbn, title, author, copies) and Member(member_id, name).
- library/store.py: class LoanError(Exception), and class Library with
  - add_book(isbn, title, author, copies=1) and add_member(member_id, name);
  - lend(isbn, member_id, day): day is an int (a day number). Raises LoanError for an unknown book or member, when no copy is available, or when the member already has 3 books;
  - return_book(isbn, member_id, day): returns the late fee as a float, 0.5 per day beyond 14 days of loan (day - lend day - 14, never below 0). Raises LoanError if that member doesn't have that book;
  - available(isbn): the number of copies not lent out;
  - save(path) writes everything (books, members, open loans, loan history) as JSON, and the classmethod Library.load(path) reads it back.
- library/report.py: overdue(library, today) returns a list of (member name, title, days overdue) for open loans with today - lend day > 14, days overdue = today - lend day - 14, sorted by days overdue descending, then name; popular(library, n) returns the titles of the n most lent books (counting every loan ever made, returned or not), most lent first, ties by title.

cli.py: python cli.py DB COMMAND ARGS..., with DB a JSON file (created if missing, saved after every command that changes something). Commands:
- add-book ISBN TITLE AUTHOR COPIES
- add-member ID NAME
- lend ISBN ID DAY
- return ISBN ID DAY, which prints "fee 1.50" (two decimals)
- overdue TODAY, which prints one line per overdue loan: "NAME | TITLE | DAYS"
On a LoanError it prints "error: <message>" and exits with status 1.

Also write tests/test_library.py (unittest, at least 8 tests, all passing) and README.md with a usage section for the CLI. Run the tests before you finish."""

CHECK = r'''
import sys, io, json, os, runpy, contextlib, unittest, tempfile
for m in [m for m in sys.modules if m == "library" or m.startswith("library.") or m in ("cli", "tests", "tests.test_library")]:
    del sys.modules[m]
sys.path.insert(0, "/workspace")
problems = []
def need(cond, what):
    if not cond: problems.append(what)
try:
    from library.store import Library, LoanError
    from library.report import overdue, popular
    from library.models import Book, Member
except Exception as e:
    print("import failed:", repr(e)); raise SystemExit
lib = Library()
lib.add_book("111", "Dune", "Herbert", copies=2)
lib.add_book("222", "Emma", "Austen")
lib.add_book("333", "Ulysses", "Joyce")
lib.add_book("444", "Beloved", "Morrison")
lib.add_member("m1", "Ana"); lib.add_member("m2", "Ben")
lib.lend("111", "m1", 1); lib.lend("111", "m2", 2)
need(lib.available("111") == 0, "available after two loans")
try: lib.lend("111", "m1", 3); problems.append("lent a book with no copy left")
except LoanError: pass
lib.lend("222", "m1", 3); lib.lend("333", "m1", 4)
try: lib.lend("444", "m1", 5); problems.append("a 4th loan for one member")
except LoanError: pass
for bad in [("999", "m1"), ("444", "zz")]:
    try: lib.lend(bad[0], bad[1], 5); problems.append(f"lent unknown {bad}")
    except LoanError: pass
need(lib.return_book("222", "m1", 10) == 0.0, "no fee within 14 days")
need(abs(lib.return_book("111", "m2", 20) - 2.0) < 1e-9, "fee 0.5 per day beyond 14 days")
try: lib.return_book("222", "m2", 30); problems.append("returned a book the member didn't have")
except LoanError: pass
need(lib.available("111") == 1, "available after a return")
od = overdue(lib, 30)
need([tuple(x) for x in od] == [("Ana", "Dune", 15), ("Ana", "Ulysses", 12)], f"overdue: {od}")
lib.lend("222", "m2", 31)
need(list(popular(lib, 2)) == ["Dune", "Emma"], f"popular: {popular(lib, 2)}")
d = tempfile.mkdtemp()
p = os.path.join(d, "lib.json")
lib.save(p)
json.load(open(p))
lib2 = Library.load(p)
need(lib2.available("111") == 1 and lib2.available("222") == 0, "load keeps open loans")
need([tuple(x) for x in overdue(lib2, 30)] == [("Ana", "Dune", 15), ("Ana", "Ulysses", 12)], "load keeps lend days")
need(list(popular(lib2, 2)) == ["Dune", "Emma"], "load keeps the loan history")
def cli(*args):
    out = io.StringIO(); code = 0
    old = sys.argv; sys.argv = ["cli.py", *args]
    try:
        with contextlib.redirect_stdout(out):
            runpy.run_path("/workspace/cli.py", run_name="__main__")
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    finally:
        sys.argv = old
    return code, out.getvalue()
db = os.path.join(d, "cli.json")
for a in [("add-book", "555", "Kim", "Kipling", "1"), ("add-member", "x1", "Cleo"), ("lend", "555", "x1", "1")]:
    c, o = cli(db, *a); need(c == 0, f"cli {a[0]} exit {c}: {o!r}")
c, o = cli(db, "lend", "555", "x1", "2")
need(c == 1 and o.strip().startswith("error:"), f"cli lend without copy: {c} {o!r}")
c, o = cli(db, "overdue", "20")
need(o.strip() == "Cleo | Kim | 5", f"cli overdue: {o!r}")
c, o = cli(db, "return", "555", "x1", "18")
need(o.strip() == "fee 1.50", f"cli return: {o!r}")
need(os.path.exists("/workspace/README.md") and "usage" in open("/workspace/README.md").read().lower(), "README with a usage section")
if os.path.exists("/workspace/tests/test_library.py"):
    suite = unittest.defaultTestLoader.discover("/workspace/tests", pattern="test*.py", top_level_dir="/workspace/tests")
    res = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
    need(res.testsRun >= 8 and res.wasSuccessful(), f"own tests: {res.testsRun} run, ok={res.wasSuccessful()}")
else:
    problems.append("no tests/test_library.py")
print("CHECK OK" if not problems else "PROBLEMS: " + "; ".join(problems))
'''

TASKS = [{"name": "build an application", "files": {}, "prompt": PROMPT, "check": CHECK}]

if __name__ == "__main__":
    main(TASKS, [], label="app")
