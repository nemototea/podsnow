/**
 * エピソード画面から Home へ戻るときに、Home に引き継ぐ処理（Issue #168）。
 *
 * - エピソード画面での削除・音声を削除は、Home へ戻ってから結果のトーストを Home で出す（E5）。
 * - 開いて何も入れずに離れた回を捨てる（FR-EP-10、E4）。
 *
 * Home は一覧を読み直す前に `settleHandoffs()` を待つ。待たないと、捨てる前・削除する前の行が
 * 一覧に残る。処理は渡した順に 1 つずつ走らせる（削除のあとに「空なら捨てる」が走っても、
 * 削除済みの回には何もしない）。
 */
type Task = () => Promise<string | null>;

let chain: Promise<string[]> = Promise.resolve([]);

/**
 * Home に引き継ぐ。戻り値の文言は Home でトーストに出す（null は出さない）。
 * 失敗を伝えたいときは、task の中で捕まえて文言（`errorText`）にして返す。投げた例外は捨てる。
 */
export function handToHome(task: Task): void {
  chain = chain.then(async (texts) => {
    try {
      const text = await task();
      return text ? [...texts, text] : texts;
    } catch {
      return texts;
    }
  });
}

/** 引き継いだ処理が終わるのを待ち、トーストに出す文言を受け取る（受け取ったら空になる）。 */
export async function settleHandoffs(): Promise<string[]> {
  const done = chain;
  chain = Promise.resolve([]);
  return done;
}
