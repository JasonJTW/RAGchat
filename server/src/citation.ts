/** A passage an answer is based on, as shown under the answer. */
export interface Citation {
  id: string;
  /** e.g. "05-projects-and-practice.md › C. 移動微型空間計畫" */
  label: string;
  /** The passage's original text, shown when the citation is expanded. */
  text: string;
}
