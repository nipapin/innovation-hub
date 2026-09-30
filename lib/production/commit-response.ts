import { NextResponse } from "next/server"
import type { CommitResult } from "./activation"

/**
 * Ответ на активацию и новую версию — один на оба роута, чтобы коды отказов
 * не разошлись. Код в теле — для интерфейса: по нему он выбирает подпись.
 */
export function commitResponse(result: CommitResult): NextResponse {
  if (result.ok) return NextResponse.json({ pipeline: result.pipeline })
  switch (result.reason) {
    case "not-found":
      return NextResponse.json({ message: "Not found." }, { status: 404 })
    case "conflict":
      return NextResponse.json(
        { message: "The pipeline was changed elsewhere.", code: "conflict" },
        { status: 409 },
      )
    case "invalid":
      return NextResponse.json(
        { message: "The pipeline has errors.", code: "invalid", issues: result.issues },
        { status: 422 },
      )
    case "storage":
      return NextResponse.json({ message: "Object storage is unavailable.", code: "storage" }, { status: 503 })
    case "project":
      return NextResponse.json({ message: "A stage folder is not yours or is gone.", code: "project" }, { status: 422 })
    default:
      return NextResponse.json(
        { message: "The pipeline is not in a state for this.", code: result.reason },
        { status: 409 },
      )
  }
}
