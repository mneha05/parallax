"use client";

interface Props {
  question: string;
  onChange: (q: string) => void;
  suggested: string[];
  onPickSuggested: (q: string) => void;
  onRun: () => void;
  running: boolean;
}

export default function QuestionInput({
  question, onChange, suggested, onPickSuggested, onRun, running,
}: Props) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div className="eyebrow">TASKING</div>
        <div className="eyebrow tnum">
          {question.length}/300
        </div>
      </div>
      <textarea
        value={question}
        onChange={(e) => onChange(e.target.value.slice(0, 300))}
        rows={3}
        placeholder="Pose a question for the investigation team…"
        className="w-full bg-transparent font-serif text-[19px] leading-snug outline-none resize-none placeholder:text-mute"
      />
      <div className="border-t hairline pt-3 mt-2">
        <div className="eyebrow mb-2">SUGGESTED QUESTIONS</div>
        <div className="flex flex-col gap-1.5">
          {suggested.map((q) => (
            <button
              key={q}
              onClick={() => onPickSuggested(q)}
              className="text-left text-[13px] text-slate hover:text-vermilion transition-colors leading-snug"
            >
              <span className="text-mute mr-1">→</span>{q}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between mt-4 pt-3 border-t hairline">
        <div className="eyebrow">
          {running ? <span className="text-vermilion">INVESTIGATION IN PROGRESS</span> : "READY"}
        </div>
        <button
          onClick={onRun}
          disabled={running || !question.trim()}
          className="px-5 py-2 bg-ink text-paper font-mono text-[12px] tracking-wider uppercase disabled:opacity-40 disabled:cursor-not-allowed hover:bg-vermilion transition-colors"
        >
          {running ? "Running…" : "Run investigation"}
        </button>
      </div>
    </div>
  );
}
