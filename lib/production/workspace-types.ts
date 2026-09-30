/**
 * Типы данных раздела «Производство» для клиента. Отдельно от
 * lib/production/workspace.ts: тот тянет базу, и в клиентский бандл ему нельзя.
 * Импорт только типов стирается при сборке, но так граница видна сразу.
 */
export type {
  MyRun,
  SchemeNodeView,
  StepFile,
  StepStatus,
  StepView,
} from "./workspace"
