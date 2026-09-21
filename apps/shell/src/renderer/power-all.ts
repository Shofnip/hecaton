/** Starts heavy browser processes one at a time, without abandoning later screens on one failure. */
export async function startAllSequentially(
  ids: readonly number[],
  start: (id: number) => Promise<unknown>,
  settle: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  for (let index = 0; index < ids.length; index++) {
    try {
      await start(ids[index]!)
    } catch (error) {
      onError(error)
    }
    if (index + 1 < ids.length) await settle()
  }
}
