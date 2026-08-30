import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  RefreshCw,
  Layers,
  Terminal,
} from 'lucide-react';
import { DiagnosticTestResult } from '../types';
import { runAllDiagnostics } from '../core/diagnostics';

interface DiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DiagnosticModal: React.FC<DiagnosticModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [testResults, setTestResults] = useState<DiagnosticTestResult[]>([]);
  const [hasRun, setHasRun] = useState(false);

  const startTests = async () => {
    setIsRunning(true);
    setHasRun(true);
    await runAllDiagnostics((results) => {
      setTestResults(results);
    });
    setIsRunning(false);
  };

  useEffect(() => {
    if (isOpen && !hasRun) {
      startTests();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const passedCount = testResults.filter((t) => t.status === 'success').length;
  const failedCount = testResults.filter((t) => t.status === 'failed').length;
  const totalCount = testResults.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        id="diagnostic-modal"
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-white text-base">Phase 1 Foundation Verification</h2>
                {hasRun && !isRunning && (
                  <span
                    className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                      failedCount === 0
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {passedCount}/{totalCount} Passed
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Automated tests verifying real Gemini integration, streaming, memory, voice & storage
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Test List Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {testResults.map((test) => {
            const isSuccess = test.status === 'success';
            const isFailed = test.status === 'failed';
            const isRunningThis = test.status === 'running';

            return (
              <div
                key={test.id}
                id={`test-card-${test.id}`}
                className={`p-3.5 rounded-xl border transition-all ${
                  isSuccess
                    ? 'bg-slate-950/70 border-slate-800'
                    : isFailed
                    ? 'bg-rose-950/20 border-rose-800/40'
                    : isRunningThis
                    ? 'bg-indigo-950/30 border-indigo-500/40'
                    : 'bg-slate-950/30 border-slate-900 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {isSuccess ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : isFailed ? (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      ) : isRunningThis ? (
                        <span className="w-4 h-4 block rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                      ) : (
                        <Clock className="w-4 h-4 text-slate-400" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">{test.name}</span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded-sm bg-slate-800 text-slate-300">
                          {test.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">{test.message}</p>
                    </div>
                  </div>

                  {test.latencyMs !== undefined && (
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {test.latencyMs}ms
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Jenna Verification Suite v1.0</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-rerun-tests"
              onClick={startTests}
              disabled={isRunning}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>{isRunning ? 'Running Tests...' : 'Rerun Suite'}</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
