import { busLesson, floodgateLesson } from "./game/lessons";
import type { FloodgateMode, NodeId, VehicleId } from "./game/scenario";
import type { GameState, TurnOrders } from "./game/turn";

type Trip = {
  vehicle: VehicleId;
  destination: NodeId;
  select: string;
  assign: string;
};

export const lessons = [
  {
    scenario: busLesson,
    title: "Автобус и посадка",
    goal: "Забери 18 человек из школы и доставь их в убежище.",
    summary: "18 человек в безопасности. Ты выбрал транспорт, задал маршрут и довёз пассажиров до убежища.",
    turns: [
      [{ vehicle: "bus-1", destination: "school", select: "Нажми на автобус у развязки.", assign: "Нажми на школу. Автобус заберёт 18 человек по прибытии." }],
      [{ vehicle: "bus-1", destination: "junction", select: "18 человек уже в автобусе. Выбери его у школы.", assign: "Нажми на развязку. За ход автобус проезжает один участок." }],
      [{ vehicle: "bus-1", destination: "shelter", select: "Автобус у моста. Выбери его.", assign: "Нажми на убежище. Там пассажиры будут в безопасности." }],
    ],
  },
  {
    scenario: floodgateLesson,
    title: "Мост и паром",
    goal: "Вывези 36 человек, пока открыты переправы.",
    summary: "36 человек в безопасности. Паром успел сделать последний рейс, а автобус проехал по мосту. В тестовом уровне решение о водосбросе появится на третьем ходу.",
    turns: [
      [
        { vehicle: "ferry", destination: "shelter", select: "Выбери паром у набережной. Для него это последний рейс.", assign: "Нажми на убежище. Паром доставит туда своих пассажиров." },
        { vehicle: "bus-2", destination: "junction", select: "Теперь выбери автобус у школы.", assign: "Нажми на развязку, чтобы автобус успел к мосту." },
      ],
      [{ vehicle: "bus-2", destination: "shelter", select: "Переправа закрылась. Выбери автобус у развязки, пока мост открыт.", assign: "Нажми на убежище. Это последний ход для проезда по мосту." }],
    ],
  },
] as const satisfies readonly {
  scenario: typeof busLesson | typeof floodgateLesson;
  title: string;
  goal: string;
  summary: string;
  turns: readonly (readonly Trip[])[];
}[];

export type Lesson = (typeof lessons)[number];
export type LessonStep =
  | { kind: "vehicle"; id: VehicleId; text: string }
  | { kind: "destination"; id: NodeId; text: string }
  | { kind: "floodgate"; id: FloodgateMode; text: string }
  | { kind: "advance" | "next"; text: string };

export function lessonStep(
  lesson: Lesson, state: GameState, selected: VehicleId | null,
  moves: NonNullable<TurnOrders["moves"]>, draft: FloodgateMode | undefined, compared: boolean,
): LessonStep {
  if (state.endReason) return { kind: "next", text: lesson.summary };
  if (state.turn === lesson.scenario.decisionTurn) {
    if (!compared) {
      return { kind: "floodgate", id: "closed", text: "Выбери «Оставить закрытым». Посмотри, сколько ходов доступен мост." };
    }
    if (draft !== "open") {
      return { kind: "floodgate", id: "open", text: "Теперь открой водосброс. Мост продержится ещё ход, а паром закончит работу раньше." };
    }
  }

  const trip = (lesson.turns[state.turn - 1] as readonly Trip[]).find(({ vehicle }) => moves[vehicle] === undefined);
  if (trip) {
    if (selected !== trip.vehicle) return { kind: "vehicle", id: trip.vehicle, text: trip.select };
    return { kind: "destination", id: trip.destination, text: trip.assign };
  }
  const text = lesson.scenario === floodgateLesson && state.turn === 1
    ? "Оба маршрута готовы. Выполни ход, чтобы отправить транспорт и открыть водосброс."
    : "Нажми «Выполнить ход», чтобы отправить транспорт.";
  return { kind: "advance", text };
}
