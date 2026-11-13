import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceTurn, createInitialState, getEvacuationReport, getRouteForecast, validateTurn,
} from "../src/game/turn.ts";

const opening = [
  { moves: { "bus-1": "hospital", "bus-2": "junction", ferry: "embankment" } },
  { moves: { "bus-1": "junction", "bus-2": "shelter", ferry: "shelter" } },
  { moves: { "bus-1": "shelter", ferry: "embankment" } },
];

const plans = [
  {
    name: "А · водосброс закрыт",
    mode: "closed",
    opening,
    tail: [
      { moves: { ferry: "shelter" } },
      { moves: { ferry: "embankment" } },
      { moves: { ferry: "shelter" } },
    ],
    evacuatedPerTurn: [0, 36, 54, 72, 72, 90],
    evacuated: { hospital: 18, school: 18, embankment: 54 },
    waiting: { hospital: 18, school: 0, embankment: 0 },
    closingTurns: [[4, "lower-road"], [5, "bridge"], [7, "ferry-crossing"]],
    endTurn: 7,
    endReason: "shelter-isolated",
  },
  {
    name: "Б · водосброс открыт",
    mode: "open",
    opening: [
      { moves: { ...opening[0].moves, "bus-1": "embankment" } },
      ...opening.slice(1),
    ],
    tail: [
      { moves: { "bus-1": "junction", ferry: "shelter" } },
      { moves: { "bus-1": "hospital" } },
      { moves: { "bus-1": "junction", "bus-2": "junction" } },
      { moves: { "bus-1": "shelter", "bus-2": "hospital" } },
      { moves: { "bus-2": "junction" } },
      { moves: { "bus-2": "shelter" } },
    ],
    evacuatedPerTurn: [0, 36, 54, 72, 72, 72, 90, 90, 108],
    evacuated: { hospital: 36, school: 18, embankment: 54 },
    waiting: { hospital: 0, school: 0, embankment: 0 },
    closingTurns: [[4, "lower-road"], [5, "ferry-crossing"]],
    endTurn: 9,
    endReason: "all-evacuated",
  },
];

function play(state, orders = {}) {
  const before = structuredClone(state);
  const result = advanceTurn(state, orders);
  assert.deepEqual(state, before);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const report = getEvacuationReport(result.state);
  for (const counts of Object.values(report.districts)) {
    assert.equal(counts.waiting + counts.inTransit + counts.evacuated, counts.initial);
  }
  return result;
}

function reject(state, orders, issues) {
  const before = structuredClone(state);
  assert.deepEqual(validateTurn(state, orders), issues);
  const result = advanceTurn(state, orders);
  assert.equal(result.ok, false);
  assert.strictEqual(result.state, state);
  assert.deepEqual(state, before);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.issues, issues);
}

function playTurns(orders) {
  const steps = [];
  let state = createInitialState();
  for (const turn of orders) {
    const result = play(state, turn);
    steps.push(result);
    state = result.state;
  }
  return { state, steps, events: steps.flatMap((step) => step.events) };
}

for (const plan of plans) {
  test("Контрольный план " + plan.name, () => {
    const { state, steps, events } = playTurns([
      ...plan.opening.slice(0, 2), { ...plan.opening[2], floodgate: plan.mode }, ...plan.tail,
    ]);

    assert.deepEqual(steps.map(({ state }) => getEvacuationReport(state).total.evacuated), plan.evacuatedPerTurn);
    assert.deepEqual(steps[2].state.vehicles, {
      "bus-1": { node: "shelter", passengers: null },
      "bus-2": { node: "shelter", passengers: null },
      ferry: { node: "embankment", passengers: null },
    });
    assert.deepEqual(state.evacuated, plan.evacuated);
    assert.deepEqual(state.waiting, plan.waiting);
    const evacuated = plan.evacuatedPerTurn.at(-1);
    assert.deepEqual(getEvacuationReport(state).total, { initial: 108, evacuated, waiting: 108 - evacuated, inTransit: 0 });
    assert.equal(state.floodgate, plan.mode);
    assert.equal(state.turn, plan.endTurn);
    assert.equal(state.endReason, plan.endReason);
    assert.deepEqual(events.filter(({ kind }) => kind === "route-closed").map(({ turn, route }) => [turn, route]), plan.closingTurns);
    assert.deepEqual(events.at(-1), { kind: "game-ended", turn: plan.endTurn, reason: plan.endReason });
    reject(state, {}, [{ kind: "game-finished" }]);
  });
}

test("Прогноз заранее показывает последние открытые и первые закрытые ходы", () => {
  for (const [mode, bridge, ferry] of [["closed", 4, 6], ["open", 9, 4]]) {
    const forecast = Object.fromEntries(getRouteForecast(mode).map(
      ({ route, lastOpenTurn, firstClosedTurn }) => [route, [lastOpenTurn, firstClosedTurn]]
    ));
    assert.deepEqual(forecast, {
      bridge: [bridge, bridge + 1],
      "ferry-crossing": [ferry, ferry + 1],
      "lower-road": [3, 4],
      "hospital-road": [null, null],
      "school-road": [null, null],
    });
  }
});

test("На третьем ходу нужен выбор, а до и после него менять режим нельзя", () => {
  const initial = createInitialState();
  reject(initial, { floodgate: "open" }, [{ kind: "unexpected-floodgate-choice" }]);
  const { state } = playTurns(opening.slice(0, 2));
  reject(state, opening[2], [{ kind: "floodgate-choice-required" }]);
  const confirmed = play(state, { ...opening[2], floodgate: "open" });
  assert.equal(confirmed.state.floodgate, "open");
  assert.deepEqual(confirmed.events[0], { kind: "floodgate-chosen", turn: 3, mode: "open" });
  reject(confirmed.state, { floodgate: "closed" }, [{ kind: "unexpected-floodgate-choice" }]);
});

test("Мост без водосброса принимает ход 4 и отклоняет ход 5", () => {
  const { state: turn4 } = playTurns([{}, {}, { floodgate: "closed" }]);
  const orders = { moves: { "bus-1": "shelter" } };
  assert.deepEqual(validateTurn(turn4, orders), []);
  const { state: turn5, events } = play(turn4, orders);
  assert.equal(turn5.vehicles["bus-1"].node, "shelter");
  assert.deepEqual(events.at(-1), { kind: "route-closed", turn: 5, route: "bridge" });
  reject(turn5, { moves: { "bus-1": "junction" } }, [
    { kind: "route-closed", vehicle: "bus-1", route: "bridge" },
  ]);
});

test("Открытый водосброс закрывает переправу перед ходом 5", () => {
  const { state: turn4 } = playTurns([{}, {}, { floodgate: "open" }]);
  const { state: turn5 } = play(turn4, { moves: { ferry: "embankment" } });
  assert.equal(turn5.vehicles.ferry.node, "embankment");
  reject(turn5, { moves: { ferry: "shelter" } }, [
    { kind: "route-closed", vehicle: "ferry", route: "ferry-crossing" },
  ]);
});

test("Девятый ход доступен, а неполная эвакуация завершается по лимиту", () => {
  const { state: turn9 } = playTurns([{}, {}, { floodgate: "open" }, {}, {}, {}, {}, {}]);
  assert.equal(turn9.turn, 9);
  assert.equal(turn9.endReason, null);
  const { state, events } = play(turn9, { moves: { "bus-1": "shelter" } });
  assert.equal(state.turn, 9);
  assert.equal(state.vehicles["bus-1"].node, "shelter");
  assert.equal(state.endReason, "turn-limit");
  assert.deepEqual(events.at(-1), { kind: "game-ended", turn: 9, reason: "turn-limit" });
  reject(state, {}, [{ kind: "game-finished" }]);
});

test("Нижняя дорога доступна на ходу 3 и закрыта на ходу 4 при обоих режимах", () => {
  for (const floodgate of ["closed", "open"]) {
    const { state } = playTurns([{}, {}, { floodgate, moves: { "bus-1": "embankment" } }]);
    assert.equal(state.vehicles["bus-1"].node, "embankment");
    reject(state, { moves: { "bus-1": "junction" } }, [
      { kind: "route-closed", vehicle: "bus-1", route: "lower-road" },
    ]);
  }
});

test("Два встречных автобуса конфликтуют, исправленный приказ выполняется", () => {
  const { state } = play(createInitialState(), { moves: { "bus-1": "shelter", "bus-2": "junction" } });
  reject(state, { moves: { "bus-1": "junction", "bus-2": "shelter" } }, [
    { kind: "route-capacity", route: "bridge", vehicles: ["bus-1", "bus-2"] },
  ]);
  const result = play(state, { moves: { "bus-1": null, "bus-2": "shelter" } });
  assert.equal(result.state.evacuated.school, 18);
  assert.equal(result.state.vehicles["bus-1"].node, "shelter");
});

test("Два автобуса в одном направлении тоже делят один мост", () => {
  const { state } = play(createInitialState(), { moves: { "bus-2": "junction" } });
  reject(state, { moves: { "bus-1": "shelter", "bus-2": "shelter" } }, [
    { kind: "route-capacity", route: "bridge", vehicles: ["bus-1", "bus-2"] },
  ]);
});

test("Недоступный сосед и неподходящий транспорт отклоняют весь ход", () => {
  reject(createInitialState(), { moves: { "bus-1": "hospital", "bus-2": "shelter", ferry: "junction" } }, [
    { kind: "not-adjacent", vehicle: "bus-2", destination: "shelter" },
    { kind: "wrong-vehicle", vehicle: "ferry", route: "bridge" },
  ]);
});

test("Ожидание не сажает людей, а полный автобус сохраняет район пассажиров", () => {
  const { state: waiting, events } = play(createInitialState());
  assert.deepEqual(events, []);
  assert.equal(waiting.waiting.school, 18);
  assert.equal(waiting.vehicles["bus-2"].passengers, null);

  const { state, steps } = playTurns([
    { moves: { "bus-2": "junction" } },
    { moves: { "bus-2": "hospital" } },
    { floodgate: "closed", moves: { "bus-2": "junction" } },
    { moves: { "bus-2": "shelter" } },
  ]);
  for (const step of steps.slice(0, 3)) {
    assert.equal(getEvacuationReport(step.state).total.evacuated, 0);
    assert.deepEqual(step.state.vehicles["bus-2"].passengers, { district: "school", count: 18 });
    assert.equal(step.state.waiting.hospital, 36);
  }
  assert.equal(state.evacuated.school, 18);
  assert.equal(state.vehicles["bus-2"].passengers, null);
});

test("Общую очередь первым забирает А1, люди в автобусе остаются в итогах", () => {
  const { state: turn7 } = playTurns([
    ...opening.slice(0, 2), { ...opening[2], floodgate: "open" },
    { moves: { "bus-1": "junction" } },
    { moves: { "bus-1": "hospital", "bus-2": "junction" } },
    { moves: { "bus-2": "hospital" } },
  ]);
  const orders = { moves: { "bus-2": "junction", "bus-1": "junction" } };
  const { state, events } = play(turn7, orders);
  assert.deepEqual(events.filter(({ kind }) => kind === "boarded"), [
    { kind: "boarded", turn: 7, vehicle: "bus-1", passengers: { district: "hospital", count: 18 } },
  ]);
  assert.equal(state.vehicles["bus-2"].passengers, null);
  assert.equal(state.vehicles["bus-2"].node, "junction");
  assert.equal(state.endReason, null);
  assert.deepEqual(getEvacuationReport(state).districts.hospital, {
    initial: 36, evacuated: 18, waiting: 0, inTransit: 18,
  });
});

test("Последняя высадка может завершить эвакуацию до закрытия переправ", () => {
  const state = createInitialState();
  const { state: finished, events } = play({
    ...state,
    turn: 2,
    waiting: { hospital: 0, school: 0, embankment: 18 },
    evacuated: { hospital: 36, school: 18, embankment: 36 },
    vehicles: { ...state.vehicles, ferry: { node: "embankment", passengers: null } },
  }, { moves: { ferry: "shelter" } });
  assert.equal(finished.turn, 2);
  assert.equal(getEvacuationReport(finished).total.evacuated, 108);
  assert.deepEqual(events.at(-1), { kind: "game-ended", turn: 2, reason: "all-evacuated" });
});

test("Повтор восстанавливает старт, одинаковые приказы дают одинаковый результат", () => {
  const initial = createInitialState();
  const first = play(initial, opening[0]);
  const second = play(initial, opening[0]);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first.state, initial);
  assert.notStrictEqual(first.state.waiting, initial.waiting);
  assert.notStrictEqual(first.state.vehicles, initial.vehicles);
  const reset = createInitialState();
  assert.deepEqual(reset, initial);
  assert.notStrictEqual(reset.waiting, initial.waiting);
  assert.equal(reset.turn, 1);
  assert.equal(reset.floodgate, null);
  assert.deepEqual(reset.closedRoutes, []);
  assert.deepEqual(reset.waiting, { hospital: 36, school: 18, embankment: 54 });
  assert.deepEqual(reset.vehicles, {
    "bus-1": { node: "junction", passengers: null },
    "bus-2": { node: "school", passengers: null },
    ferry: { node: "shelter", passengers: null },
  });
});
