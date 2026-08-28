import { describe, expect, it } from "vitest";
import {
  buildServerDedupeKey,
  decideEmailReservation,
  isDuplicateReservationError,
  EMAIL_RESERVATION_STALE_MS,
} from "./checklist-email";

const NOW = Date.parse("2026-08-28T12:00:00Z");

describe("decisão de reserva de e-mail", () => {
  it("sem linha prévia → reserva", () => {
    expect(decideEmailReservation({ existing: null, now: NOW })).toBe("reserved");
  });

  it("destinatário já enviado → nunca reenvia", () => {
    expect(decideEmailReservation({ existing: { status: "sent" }, now: NOW })).toBe("already_sent");
  });

  it("pending recente → outra execução está no ar", () => {
    const attempted = new Date(NOW - 60_000).toISOString();
    expect(decideEmailReservation({ existing: { status: "pending", attempted_at: attempted }, now: NOW }))
      .toBe("in_flight");
  });

  it("pending obsoleto (crash) → recupera com nova tentativa", () => {
    const attempted = new Date(NOW - EMAIL_RESERVATION_STALE_MS - 1000).toISOString();
    expect(decideEmailReservation({ existing: { status: "pending", attempted_at: attempted }, now: NOW }))
      .toBe("retry");
  });

  it("pending sem timestamp nenhum não trava para sempre", () => {
    expect(decideEmailReservation({ existing: { status: "pending" }, now: NOW })).toBe("retry");
  });

  it("failed permite nova tentativa", () => {
    expect(decideEmailReservation({ existing: { status: "failed" }, now: NOW })).toBe("retry");
  });

  it("destinatário A enviado não impede o destinatário B novo", () => {
    const a = decideEmailReservation({ existing: { status: "sent" }, now: NOW });
    const b = decideEmailReservation({ existing: null, now: NOW });
    expect(a).toBe("already_sent");
    expect(b).toBe("reserved");
  });
});

describe("erro de banco não é deduplicação", () => {
  it("apenas 23505 conta como duplicidade", () => {
    expect(isDuplicateReservationError({ code: "23505" })).toBe(true);
    expect(isDuplicateReservationError({ code: "42501" })).toBe(false);
    expect(isDuplicateReservationError({ code: "08006" })).toBe(false);
    expect(isDuplicateReservationError(null)).toBe(false);
  });
});

describe("chave de deduplicação gerada no servidor", () => {
  it("inclui evento, checklist e destinatário", () => {
    const key = buildServerDedupeKey({
      eventType: "audit_alert",
      checklistId: "abc",
      recipient: "Gestor@Empresa.com",
    });
    expect(key).toBe("audit_alert|abc|gestor@empresa.com");
  });

  it("destinatários diferentes geram chaves diferentes", () => {
    const base = { eventType: "nc", checklistId: "abc" };
    expect(buildServerDedupeKey({ ...base, recipient: "a@x.com" }))
      .not.toBe(buildServerDedupeKey({ ...base, recipient: "b@x.com" }));
  });

  it("discriminador do cliente é sanitizado e nunca vira a chave global", () => {
    const key = buildServerDedupeKey({
      eventType: "nc",
      checklistId: "abc",
      recipient: "a@x.com",
      discriminator: "nc|outro-checklist qualquer",
    });
    expect(key.startsWith("nc|abc|a@x.com|")).toBe(true);
    expect(key.split("|")).toHaveLength(4);
  });
});
