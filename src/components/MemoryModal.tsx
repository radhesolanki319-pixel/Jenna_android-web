import React, { useState } from 'react';
import {
  X,
  Brain,
  Plus,
  Trash2,
  Edit3,
  Check,
  Search,
  Download,
  Upload,
  Sparkles,
  Layers,
  ArrowUpCircle,
  Clock,
  Shield,
  HelpCircle,
} from 'lucide-react';
import { MemoryItem, MemoryCategory, MemoryPriority, Message } from '../types';
import { memoryService, MEMORY_CATEGORIES } from '../core/memoryStore';

interface MemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMessages: Message[];
}

export const MemoryModal: React.FC<MemoryModalProps> = ({
  isOpen,
  onClose,
  currentMessages,
}) => {
  const [activeCategory, setActiveCategory] = useState<MemoryCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Add form state
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('preferences');
  const [newPriority, setNewPriority] = useState<MemoryPriority>('medium');
  
  // Edit mode state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<MemoryCategory>('preferences');
  const [editPriority, setEditPriority] = useState<MemoryPriority>('medium');

  // AI Extraction & Import state
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedSuggestions, setExtractedSuggestions] = useState<MemoryItem[]>([]);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const allMemories = memoryService.getAll();

  const filteredMemories = allMemories.filter((m) => {
    const text = (m.content || m.fact || '').toLowerCase();
    const cat = m.category.toLowerCase();
    const query = searchQuery.toLowerCase().trim();

    const matchesCategory = activeCategory === 'all' || m.category === activeCategory;
    const matchesSearch = !query || text.includes(query) || cat.includes(query);
    return matchesCategory && matchesSearch;
  });

  const showNotification = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    await memoryService.addMemory(
      newCategory,
      newContent.trim(),
      newPriority,
      1.0
    );
    setNewContent('');
    showNotification('Memory recorded and persisted to long-term storage.');
  };

  const startEditing = (mem: MemoryItem) => {
    setEditingId(mem.id);
    setEditContent(mem.content || mem.fact || '');
    setEditCategory(mem.category);
    setEditPriority(mem.priority || (mem.isPinned ? 'high' : 'medium'));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editContent.trim()) return;

    await memoryService.updateMemory(id, {
      content: editContent.trim(),
      fact: editContent.trim(),
      category: editCategory,
      priority: editPriority,
      isPinned: editPriority === 'high',
    });

    setEditingId(null);
    showNotification('Memory updated successfully.');
  };

  const handleToggle = async (id: string) => {
    await memoryService.toggleMemory(id);
  };

  const handlePriorityChange = async (id: string, priority: MemoryPriority) => {
    await memoryService.setPriority(id, priority);
    showNotification(`Priority changed to ${priority.toUpperCase()}.`);
  };

  const handleDelete = async (id: string) => {
    await memoryService.deleteMemory(id);
    if (editingId === id) setEditingId(null);
    showNotification('Memory permanently removed from storage.');
  };

  const handleExtractFromChat = async () => {
    if (currentMessages.length === 0) {
      showNotification('No messages in the active chat to extract memories from.');
      return;
    }

    setIsExtracting(true);
    try {
      const extracted = await memoryService.extractMemoriesFromChat(
        currentMessages.map((m) => ({ role: m.role, content: m.content }))
      );
      setExtractedSuggestions(extracted);
      if (extracted.length === 0) {
        showNotification('No new persistent facts detected in this conversation.');
      } else {
        showNotification(`Found ${extracted.length} potential memories for your approval.`);
      }
    } catch {
      showNotification('Failed to extract memories from conversation.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleApproveExtracted = async (item: MemoryItem) => {
    await memoryService.addMemory(
      item.category,
      item.content || item.fact || '',
      item.priority || 'medium',
      item.confidence || 0.95
    );
    setExtractedSuggestions((prev) => prev.filter((i) => (i.content || i.fact) !== (item.content || item.fact)));
    showNotification('Approved memory saved.');
  };

  const handleExport = () => {
    const json = memoryService.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jenna-memories-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const count = await memoryService.importJSON(importText);
      showNotification(`Imported ${count} memories.`);
      setShowImport(false);
      setImportText('');
    } catch (err: any) {
      showNotification(err.message || 'Import failed.');
    }
  };

  const formatDate = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        id="memory-modal"
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/25">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-white text-base">Long-Term Memory Hub</h2>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {allMemories.length} {allMemories.length === 1 ? 'record' : 'records'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                User-approved persistent memory foundation completely isolated from ephemeral chat logs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExport}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Export Memories (JSON)"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowImport(!showImport)}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Import Memories (JSON)"
            >
              <Upload className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback Banner */}
        {feedbackMsg && (
          <div className="px-6 py-2.5 bg-indigo-950/90 border-b border-indigo-800/60 text-xs text-indigo-200 flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
            <button onClick={() => setFeedbackMsg(null)} className="text-indigo-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Import JSON Box */}
        {showImport && (
          <form onSubmit={handleImportSubmit} className="p-4 bg-slate-950 border-b border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Import Memories (JSON)</span>
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
            <textarea
              rows={3}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste Jenna memories JSON export payload here..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 font-mono focus:outline-hidden focus:border-indigo-500"
            />
            <div className="flex justify-end mt-2">
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                Import Records
              </button>
            </div>
          </form>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Smart Memory Discovery Banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/40 via-slate-900 to-indigo-950/20 border border-indigo-800/40">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-300">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white">Extract Facts from Conversation</h4>
                <p className="text-[11px] text-slate-400">
                  Analyze active chat for explicit user preferences, facts, or instructions.
                </p>
              </div>
            </div>
            <button
              id="btn-extract-memories"
              onClick={handleExtractFromChat}
              disabled={isExtracting}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
            >
              {isExtracting ? (
                <>
                  <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Brain className="w-3.5 h-3.5" />
                  <span>Extract from Chat</span>
                </>
              )}
            </button>
          </div>

          {/* Discovered Suggestions Pending Approval */}
          {extractedSuggestions.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Discovered Facts for User Approval ({extractedSuggestions.length})
                </span>
                <button
                  onClick={() => setExtractedSuggestions([])}
                  className="text-[11px] text-amber-400/80 hover:text-amber-200"
                >
                  Dismiss all
                </button>
              </div>
              <div className="space-y-2">
                {extractedSuggestions.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs"
                  >
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-amber-400 block mb-0.5">
                        {item.category.replace(/_/g, ' ')}
                      </span>
                      <span className="text-slate-200">{item.content || item.fact}</span>
                    </div>
                    <button
                      onClick={() => handleApproveExtracted(item)}
                      className="px-2.5 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shrink-0 font-medium"
                    >
                      <Check className="w-3 h-3" />
                      Approve & Save
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add New Memory Record Form */}
          <form
            onSubmit={handleAddMemory}
            className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3"
          >
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              Add Structured Long-Term Memory
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              {/* Memory Text */}
              <div className="sm:col-span-6">
                <input
                  type="text"
                  placeholder="e.g. Always structure coding solutions with TypeScript and best practices"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              {/* Category */}
              <div className="sm:col-span-3">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                >
                  {MEMORY_CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div className="sm:col-span-3">
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as MemoryPriority)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="high">High Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="low">Low Priority</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Shield className="w-3 h-3 text-indigo-400" />
                Explicitly saved to local persistent storage.
              </span>

              <button
                type="submit"
                disabled={!newContent.trim()}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Save Memory
              </button>
            </div>
          </form>

          {/* Filter Tabs & Search */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                <button
                  onClick={() => setActiveCategory('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-colors ${
                    activeCategory === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  All ({allMemories.length})
                </button>
                {MEMORY_CATEGORIES.map((cat) => {
                  const count = memoryService.getByCategory(cat.id).length;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-colors flex items-center gap-1.5 ${
                        activeCategory === cat.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span>{cat.label}</span>
                      <span className="text-[10px] opacity-75 font-mono">({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Search Bar */}
              <div className="relative shrink-0">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter records..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-48 bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-hidden"
                />
              </div>
            </div>

            {/* Memories List */}
            <div className="space-y-2.5">
              {filteredMemories.map((mem) => {
                const isEditing = editingId === mem.id;
                const priority = mem.priority || (mem.isPinned ? 'high' : 'medium');

                if (isEditing) {
                  return (
                    <div
                      key={mem.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-indigo-600/50 shadow-md space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-indigo-400">Edit Memory</span>
                        <span className="text-[10px] text-slate-500 font-mono">ID: {mem.id}</span>
                      </div>

                      <textarea
                        rows={2}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-hidden focus:border-indigo-500 font-sans"
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-1">Category</label>
                          <select
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value as MemoryCategory)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                          >
                            {MEMORY_CATEGORIES.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 block mb-1">Priority Level</label>
                          <select
                            value={editPriority}
                            onChange={(e) => setEditPriority(e.target.value as MemoryPriority)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden"
                          >
                            <option value="high">High Priority</option>
                            <option value="medium">Medium Priority</option>
                            <option value="low">Low Priority</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(mem.id)}
                          disabled={!editContent.trim()}
                          className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={mem.id}
                    id={`memory-item-${mem.id}`}
                    className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border transition-all ${
                      mem.enabled
                        ? 'bg-slate-950/70 border-slate-800/90 text-slate-100'
                        : 'bg-slate-950/30 border-slate-900/60 text-slate-500'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-indigo-300 border border-slate-700/60">
                          {mem.category.replace(/_/g, ' ')}
                        </span>

                        {/* Priority Selector Pill */}
                        <div className="flex items-center gap-1">
                          <select
                            value={priority}
                            onChange={(e) => handlePriorityChange(mem.id, e.target.value as MemoryPriority)}
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border cursor-pointer focus:outline-hidden ${
                              priority === 'high'
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                : priority === 'medium'
                                ? 'bg-slate-800 text-slate-300 border-slate-700'
                                : 'bg-slate-900 text-slate-400 border-slate-800'
                            }`}
                            title="Change Priority"
                          >
                            <option value="high">HIGH PRIORITY</option>
                            <option value="medium">MEDIUM PRIORITY</option>
                            <option value="low">LOW PRIORITY</option>
                          </select>
                        </div>

                        {/* Timestamp */}
                        <span className="text-[10px] text-slate-500 flex items-center gap-1 ml-auto">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDate(mem.updatedAt || mem.createdAt)}
                        </span>
                      </div>

                      <p className={`text-xs leading-relaxed ${!mem.enabled ? 'line-through opacity-60' : 'text-slate-200'}`}>
                        {mem.content || mem.fact}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                      {/* Enable/Disable Toggle */}
                      <button
                        onClick={() => handleToggle(mem.id)}
                        className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${
                          mem.enabled ? 'bg-indigo-600' : 'bg-slate-800'
                        }`}
                        title={mem.enabled ? 'Enabled in prompt injection' : 'Disabled (Ignored)'}
                      >
                        <div
                          className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                            mem.enabled ? 'translate-x-3.5' : 'translate-x-0'
                          }`}
                        />
                      </button>

                      {/* Edit Button */}
                      <button
                        onClick={() => startEditing(mem)}
                        className="p-1.5 text-slate-400 hover:text-indigo-400 rounded-lg hover:bg-slate-800 transition-colors"
                        title="Edit Memory"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      {/* Delete Button */}
                      <button
                        onClick={() => handleDelete(mem.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                        title="Delete Memory"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {filteredMemories.length === 0 && (
                <div className="text-center py-10 text-xs text-slate-500 bg-slate-950/20 rounded-xl border border-dashed border-slate-800/80">
                  No memories found matching your criteria.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Jenna Persistent Memory Foundation v1.0</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
