import { describe, expect, it } from "vitest";
import { addSelfie, api, env, expectError, fakeFaceService, json, signup, storedKeys } from "./helpers";

describe("reference selfies", () => {
  it("accepts only an image with one main face", async () => {
    const ana = await signup("Ana");
    await expectError(addSelfie(ana, { faces: [] }), 422, "no_face");
    await expectError(addSelfie(ana, { status: 422 }), 422, "no_face");
    await expectError(addSelfie(ana, { faces: [1, 2] }), 422, "multiple_faces");
    expect(await storedKeys()).toEqual([]);

    const { selfie } = await json(addSelfie(ana, { faces: [1] }));
    expect(selfie.url).toBe(`/api/me/selfies/${selfie.id}/image`);
    expect((await json(api("/api/me", { as: ana }))).user.selfies).toEqual([selfie]);
    const image = await api(selfie.url, { as: ana });
    expect([image.headers.get("content-type"), new TextDecoder().decode(await image.arrayBuffer())]).toEqual(["image/jpeg", "thumb"]);
    await expectError(api(selfie.url, { as: await signup("Bia") }), 404, "not_found");

    const stored = await env.DB.prepare("SELECT embedding FROM selfies").first<{ embedding: ArrayBuffer }>();
    expect(new Uint8Array(stored!.embedding).length, "512 Float32 values").toBe(2048);
  });

  it("ignores faces far smaller than the main one", async () => {
    const ana = await signup("Ana");
    await expectError(addSelfie(ana, { faces: [1, 2], heights: [0.5, 0.3] }), 422, "multiple_faces");
    await expectError(addSelfie(ana, { faces: [1, 2, 3], heights: [0.05, 0.3, 0.3] }), 422, "multiple_faces");
    expect(await storedKeys()).toEqual([]);

    await json(addSelfie(ana, { faces: [7, 1, 8], heights: [0.04, 0.5, 0.19] }));
    const stored = await env.DB.prepare("SELECT embedding FROM selfies").first<{ embedding: ArrayBuffer }>();
    expect(new Float32Array(new Uint8Array(stored!.embedding).buffer)[1], "the vector kept is the one of the large face").toBe(1);
  });

  it("tells a failed analysis from a service that is still starting", async () => {
    const ana = await signup("Ana");
    const failed = await expectError(addSelfie(ana, { faces: [1], status: 500 }), 503, "face_service_unavailable");
    expect(failed).toContain("falhou");
    const starting = await expectError(addSelfie(ana, { faces: [1], status: 503 }), 503, "face_service_unavailable");
    expect(starting).toContain("Tente de novo em um minuto");
    await fakeFaceService().crashNextAnalysis();
    expect(await expectError(addSelfie(ana, { faces: [1] }), 503, "face_service_unavailable")).toContain("Tente de novo em um minuto");
    expect(await storedKeys()).toEqual([]);
  });

  it("keeps at most five per user", async () => {
    const ana = await signup("Ana");
    for (let seed = 1; seed <= 5; seed++) await json(addSelfie(ana, { faces: [seed] }));
    await expectError(addSelfie(ana, { faces: [6] }), 409, "selfie_limit");

    const { user } = await json(api("/api/me", { as: ana }));
    await json(api(`/api/me/selfies/${user.selfies[0].id}`, { as: ana, method: "DELETE" }), 204);
    await json(addSelfie(ana, { faces: [6] }));
    expect(await storedKeys()).toHaveLength(5);
  });

  it("asks to try again when the face service is down, leaving nothing pending", async () => {
    const ana = await signup("Ana");
    await fakeFaceService().setHealthy(false);
    const message = await expectError(addSelfie(ana, { faces: [1] }), 503, "face_service_unavailable");
    expect(message).toContain("Tente de novo em um minuto");
    expect(await fakeFaceService().lastReadyWaitMs(), "a short wait, not the cold start").toBe(20_000);
    expect((await json(api("/api/me", { as: ana }))).user.selfies).toEqual([]);
  });

  it("refuses a selfie body over 25 MB", async () => {
    const ana = await signup("Ana");
    const oversized = api("/api/me/selfies", { as: ana, body: new Uint8Array(25 * 1024 ** 2 + 1) });
    await expectError(oversized, 413, "file_too_large");
  });
});
