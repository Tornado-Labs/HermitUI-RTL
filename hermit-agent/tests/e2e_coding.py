"""Real-model coding suite: six programming tasks of the kind a developer hands an
agent, each checked by hidden tests the model never sees. It complements
e2e_reference.py (mostly data and file-format work, with three small coding tasks) and
runs through the same runner, so the flags, approvals and results file are the same:

    ../benchmark/.venv/bin/python tests/e2e_coding.py --base-url http://localhost:9931/v1 [--runs 3] [--tool-mode native|text]
    ../benchmark/.venv/bin/python tests/e2e_coding.py --only "bug hunt,performance"
    ../benchmark/.venv/bin/python tests/e2e_coding.py --quick   # the QUICK three, once

The tasks: make a given test file pass (LRU cache), find two bugs across two files from
a symptom, speed up an O(n²) function without changing its results, add a feature to
existing code and its tests, write an expression evaluator without eval, and write
tests good enough to catch planted bugs (mutation testing). Results go to
tests/results/coding-<time>.json.
"""
import hashlib
import json

from e2e_reference import main

# --- 1. make the tests pass: the tests exist, the module doesn't ---------------------

TEST_LRU_PY = '''import unittest
from lru import LRUCache


class TestLRU(unittest.TestCase):
    def test_get_missing(self):
        self.assertIsNone(LRUCache(2).get("x"))

    def test_put_get(self):
        c = LRUCache(2)
        c.put("a", 1)
        self.assertEqual(c.get("a"), 1)

    def test_evicts_least_recently_used(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        c.get("a")
        c.put("c", 3)
        self.assertIsNone(c.get("b"))
        self.assertEqual(c.get("a"), 1)

    def test_len(self):
        c = LRUCache(2)
        for k in "abc":
            c.put(k, k)
        self.assertEqual(len(c), 2)
'''

# --- 2. bug hunt: a shared mutable default, and a discount that starts one too late ---

CART_PY = '''from pricing import line_total


class Cart:
    def __init__(self, owner, items=[]):
        self.owner = owner
        self.items = items

    def add(self, sku, qty, unit_price):
        self.items.append({"sku": sku, "qty": qty, "unit_price": unit_price})

    def total(self):
        return round(sum(line_total(i) for i in self.items), 2)
'''

PRICING_PY = '''def line_total(item):
    """qty x unit price, with 10 % off a line of 10 or more."""
    total = item["qty"] * item["unit_price"]
    if item["qty"] > 10:
        total *= 0.9
    return total
'''

MAIN_PY = '''from cart import Cart

ana = Cart("ana")
ana.add("pen", 10, 1.5)
ben = Cart("ben")
ben.add("ink", 2, 4.0)
print(ana.owner, ana.total())
print(ben.owner, ben.total())
'''

# --- 3. performance: same results, O(n) instead of O(n²) -----------------------------

PAIRS_PY = '''def count_pairs(nums, target):
    """How many index pairs i < j have nums[i] + nums[j] == target."""
    count = 0
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                count += 1
    return count
'''

# --- 4. a feature in existing code -----------------------------------------------------

TODO_PY = '''import json


class TodoList:
    def __init__(self):
        self.items = []

    def add(self, title):
        self.items.append({"title": title, "done": False})

    def complete(self, title):
        for item in self.items:
            if item["title"] == title:
                item["done"] = True
                return
        raise KeyError(title)

    def pending(self):
        return [i["title"] for i in self.items if not i["done"]]

    def save(self, path):
        with open(path, "w") as f:
            json.dump(self.items, f)

    @classmethod
    def load(cls, path):
        todo = cls()
        with open(path) as f:
            todo.items = json.load(f)
        return todo
'''

TEST_TODO_PY = '''import os
import tempfile
import unittest
from todo import TodoList


class TestTodo(unittest.TestCase):
    def test_add_and_pending(self):
        t = TodoList()
        t.add("milk")
        t.add("bread")
        self.assertEqual(t.pending(), ["milk", "bread"])

    def test_complete(self):
        t = TodoList()
        t.add("milk")
        t.complete("milk")
        self.assertEqual(t.pending(), [])

    def test_complete_unknown(self):
        with self.assertRaises(KeyError):
            TodoList().complete("nope")

    def test_save_load(self):
        t = TodoList()
        t.add("milk")
        path = os.path.join(tempfile.mkdtemp(), "todo.json")
        t.save(path)
        self.assertEqual(TodoList.load(path).pending(), ["milk"])
'''

# --- 6. tests that catch bugs: the function is right, the mutants each break one thing --

INTERVAL_PY = '''def merge(intervals):
    """Merge overlapping or touching closed intervals [start, end]; return them sorted by start.

    merge([[1, 3], [2, 6], [8, 10]]) == [[1, 6], [8, 10]]
    merge([[1, 4], [4, 5]]) == [[1, 5]]
    """
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result
'''


def mutant(old, new):
    assert INTERVAL_PY.count(old) == 1, old
    return INTERVAL_PY.replace(old, new)


INTERVAL_MUTANTS = {
    "unsorted input not sorted": mutant("in sorted(intervals):", "in intervals:"),
    "touching intervals not merged": mutant("start <= result", "start < result"),
    "a contained interval shrinks the end": mutant("max(result[-1][1], end)", "end"),
    "sorted by end instead of start": mutant("sorted(intervals)", "sorted(intervals, key=lambda iv: iv[1])"),
}


def sha(text):
    return repr(hashlib.sha256(text.encode()).hexdigest())


# Same task format as e2e_reference.py: `check` runs in the agent's interpreter after the
# task and must print CHECK OK. The checks are stricter than the prompts' own examples, so
# passing them takes code that works, not code that fits the visible tests.
TASKS = [
    {
        "name": "make the tests pass (LRU cache)",
        "files": {"test_lru.py": TEST_LRU_PY},
        "prompt": "test_lru.py tests an LRUCache class that hasn't been written yet. Write lru.py so that all the tests pass, without changing test_lru.py. Also: putting a key that is already there updates its value and makes it the most recently used, and a capacity below 1 raises ValueError. Run the tests and report the result.",
        "check": """
import hashlib, sys
sys.modules.pop("lru", None)
from lru import LRUCache
c = LRUCache(2)
c.put("a", 1); c.put("b", 2); c.put("a", 10); c.put("c", 3)
assert c.get("b") is None and c.get("a") == 10 and c.get("c") == 3 and len(c) == 2, "updating a key must refresh it"
c = LRUCache(1)
c.put(1, "x"); c.put(2, "y")
assert c.get(1) is None and c.get(2) == "y" and len(c) == 1
c = LRUCache(3)
for k in "abc":
    c.put(k, k)
c.get("a"); c.get("b"); c.put("d", "d")
assert c.get("c") is None and [c.get(k) for k in "abd"] == ["a", "b", "d"], "reads must count as use"
for bad in (0, -1):
    try:
        LRUCache(bad)
        raise AssertionError(f"capacity {bad} accepted")
    except ValueError:
        pass
assert hashlib.sha256(open("/workspace/test_lru.py", "rb").read()).hexdigest() == """ + sha(TEST_LRU_PY) + """, "test_lru.py was changed"
print("CHECK OK")
""",
    },
    {
        "name": "bug hunt across files",
        "files": {"cart.py": CART_PY, "pricing.py": PRICING_PY, "main.py": MAIN_PY},
        "prompt": "main.py should print 'ana 13.5' and 'ben 8.0' (ana's 10 pens get the 10 % bulk discount), but it prints something else. Find and fix the bugs in cart.py and pricing.py, leave main.py as it is, and run it to show the output.",
        "needs_approval": True,
        "check": """
import contextlib, hashlib, io, runpy, sys
for m in ("cart", "pricing"):
    sys.modules.pop(m, None)
from cart import Cart
from pricing import line_total
a = Cart("a")
a.add("x", 1, 1.0)
b = Cart("b")
assert b.items == [] and b.total() == 0, "carts share their items"
assert line_total({"qty": 10, "unit_price": 1.0}) == 9.0, "10 items must get the discount"
assert line_total({"qty": 9, "unit_price": 1.0}) == 9.0, "9 items must not"
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    runpy.run_path("/workspace/main.py", run_name="__main__")
assert buf.getvalue().split() == ["ana", "13.5", "ben", "8.0"], buf.getvalue()
assert hashlib.sha256(open("/workspace/main.py", "rb").read()).hexdigest() == """ + sha(MAIN_PY) + """, "main.py was changed"
print("CHECK OK")
""",
    },
    {
        "name": "performance fix",
        "files": {"pairs.py": PAIRS_PY},
        "prompt": "count_pairs in pairs.py is far too slow for real data: a list of 200,000 numbers takes forever. Make it fast (a second or so for 200,000 numbers) without changing its signature or its results, and check the new version against the old one on small random inputs.",
        "needs_approval": True,
        "check": """
import random, sys, time
from collections import Counter
sys.modules.pop("pairs", None)
from pairs import count_pairs
def slow(nums, target):
    return sum(1 for i in range(len(nums)) for j in range(i + 1, len(nums)) if nums[i] + nums[j] == target)
rnd = random.Random(7)
for _ in range(300):
    nums = [rnd.randint(-5, 5) for _ in range(rnd.randint(0, 30))]
    t = rnd.randint(-6, 6)
    assert count_pairs(list(nums), t) == slow(nums, t), (nums, t)
assert count_pairs([], 3) == 0 and count_pairs([2, 2, 2], 4) == 3 and count_pairs([1, 1], 1) == 0
# A quadratic version would hang the check on 200,000 numbers: rule it out on 10,000 first.
t0 = time.time()
count_pairs([rnd.randint(-1000, 1000) for _ in range(10000)], 0)
assert time.time() - t0 < 0.3, f"still quadratic: 10,000 numbers took {time.time() - t0:.1f} s"
big = [rnd.randint(-1000, 1000) for _ in range(200000)]
c = Counter(big)
want = sum(c[v] * c[-v] for v in c if v > 0) + c[0] * (c[0] - 1) // 2
t0 = time.time()
got = count_pairs(big, 0)
dt = time.time() - t0
assert got == want, (got, want)
assert dt < 3, f"200,000 numbers took {dt:.1f} s"
print("CHECK OK")
""",
    },
    {
        "name": "add a feature",
        "files": {"todo.py": TODO_PY, "test_todo.py": TEST_TODO_PY},
        "prompt": "Add priorities to todo.py: add(title, priority='normal') accepts 'high', 'normal' or 'low' and raises ValueError for anything else, and pending() lists high first, then normal, then low, keeping the order they were added within each priority. Lists saved by the current version (items without a priority) must still load, their items counting as normal. Add tests for this to test_todo.py and run all the tests.",
        "needs_approval": True,
        "check": """
import io, json, os, sys, tempfile, types, unittest
for m in ("todo", "test_todo"):
    sys.modules.pop(m, None)
from todo import TodoList
t = TodoList()
t.add("a"); t.add("b", priority="low"); t.add("c", priority="high"); t.add("d"); t.add("e", priority="high")
assert t.pending() == ["c", "e", "a", "d", "b"], t.pending()
t.complete("c")
assert t.pending() == ["e", "a", "d", "b"], t.pending()
for bad in ("urgent", "", 1):
    try:
        TodoList().add("x", priority=bad)
        raise AssertionError(f"priority {bad!r} accepted")
    except ValueError:
        pass
d = tempfile.mkdtemp()
old = os.path.join(d, "old.json")
with open(old, "w") as f:
    json.dump([{"title": "x", "done": False}, {"title": "y", "done": True}, {"title": "z", "done": False}], f)
t = TodoList.load(old)
t.add("w", priority="high"); t.add("v", priority="low")
assert t.pending() == ["w", "x", "z", "v"], t.pending()
t.save(os.path.join(d, "new.json"))
assert TodoList.load(os.path.join(d, "new.json")).pending() == ["w", "x", "z", "v"], "priorities lost on save/load"
def run(mod):
    return unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(unittest.defaultTestLoader.loadTestsFromModule(mod))
orig = types.ModuleType("orig_test_todo")
exec(""" + repr(TEST_TODO_PY) + """, orig.__dict__)
r = run(orig)
assert r.wasSuccessful() and r.testsRun == 4, ("the original tests fail", r.failures, r.errors)
src = open("/workspace/test_todo.py").read()
assert "priority" in src, "no priority tests in test_todo.py"
import test_todo
r = run(test_todo)
assert r.wasSuccessful() and r.testsRun > 4, ("test_todo.py", r.testsRun, r.failures, r.errors)
print("CHECK OK")
""",
    },
    {
        "name": "expression evaluator",
        "files": {},
        "prompt": "Write calc.py with calculate(expr) that evaluates arithmetic expressions: integers and decimals, only the operators + - * /, parentheses, unary minus, and the usual precedence (left to right within a level). Don't use eval, exec, compile, ast or any parsing library. Malformed input (such as '2 +', '(1', '1 2', 'abc' or '') must raise ValueError; division by zero may raise ZeroDivisionError. Add unittest tests in test_calc.py and run them.",
        "check": """
import builtins, sys
sys.modules.pop("calc", None)
from calc import calculate
good = {"2 + 3 * 4": 14, "(2 + 3) * 4": 20, "-3 + 5": 2, "2 * -3": -6, "--2": 2, "10 / 4": 2.5, "8 - 3 - 2": 3,
        "100 / 10 / 5": 2, "1.5 + 2.25": 3.75, "-(1 + 2) * 3": -9, " 7 ": 7, "2*(3+(4-1))*2": 24, "0.1 * 3": 0.3}
bad = ["2 +", "(1", "1 2", "abc", "", "1 + )", "()", "2 ** 3", "4 // 2", "1..2"]
def boom(*a, **k):
    raise AssertionError("calculate used eval, exec or compile")
saved = builtins.eval, builtins.exec, builtins.compile
builtins.eval = builtins.exec = builtins.compile = boom
try:
    for expr, want in good.items():
        got = calculate(expr)
        assert abs(float(got) - want) < 1e-9, (expr, got, want)
    for expr in bad:
        try:
            calculate(expr)
        except ValueError:
            continue
        raise AssertionError("accepted " + repr(expr))
finally:
    builtins.eval, builtins.exec, builtins.compile = saved
import os
assert os.path.exists("/workspace/test_calc.py")
print("CHECK OK")
""",
    },
    {
        "name": "tests that catch bugs",
        "files": {"interval.py": INTERVAL_PY},
        "prompt": "interval.py has a merge() function. Write thorough unittest tests for it in test_interval.py, covering what its docstring promises and the edge cases, and run them. Don't change interval.py.",
        "check": """
import hashlib, importlib.util, io, os, sys, tempfile, unittest
def run_tests(src):
    d = tempfile.mkdtemp()
    open(os.path.join(d, "interval.py"), "w").write(src)
    sys.path.insert(0, d)
    sys.modules.pop("interval", None)
    try:
        spec = importlib.util.spec_from_file_location("check_test_interval", "/workspace/test_interval.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        r = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(unittest.defaultTestLoader.loadTestsFromModule(mod))
        return r.wasSuccessful(), r.testsRun
    finally:
        sys.path.remove(d)
        sys.modules.pop("interval", None)
ok, n = run_tests(""" + repr(INTERVAL_PY) + """)
assert ok and n > 0, f"the tests fail on the correct merge() ({n} run)"
survived = [name for name, src in """ + repr(INTERVAL_MUTANTS) + """.items() if run_tests(src)[0]]
assert not survived, "bugs the tests miss: " + ", ".join(survived)
assert hashlib.sha256(open("/workspace/interval.py", "rb").read()).hexdigest() == """ + sha(INTERVAL_PY) + """, "interval.py was changed"
print("CHECK OK")
""",
    },
]

QUICK = ["bug hunt across files", "performance fix", "make the tests pass (LRU cache)"]


if __name__ == "__main__":
    main(TASKS, QUICK, label="coding")
