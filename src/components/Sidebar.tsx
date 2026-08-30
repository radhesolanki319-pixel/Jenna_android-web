import React, { useState } from 'react';
import {
  Plus,
  MessageSquare,
  Pin,
  Trash2,
  Edit2,
  Check,
  Brain,
  Settings,
  Activity,
  Smartphone,
  Monitor,
  Search,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { Conversation, JennaSettings } from '../types';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onOpenMemory: () => void;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
  memoryCount: number;
  settings: JennaSettings;
  onUpdateSettings: (updates: Partial<JennaSettings>) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onUpdateTitle,
  onTogglePin,
  onOpenMemory,
  onOpenSettings,
  onOpenDiagnostics,
  memoryCount,
  settings,
  onUpdateSettings,
  isMobileOpen,
  onCloseMobile,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitleText, setEditTitleText] = useState('');

  const handleStartEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitleText(conv.title);
  };

  const handleSaveEdit = (id: string, e?: React.FormEvent) => {
    e?.preventDefault();
    if (editTitleText.trim()) {
      onUpdateTitle(id, editTitleText.trim());
    }
    setEditingId(null);
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.previewText && c.previewText.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const pinned = filteredConversations.filter((c) => c.isPinned);
  const unpinned = filteredConversations.filter((c) => !c.isPinned);

  // Group unpinned by time
  const now = Date.now();
  const oneDay = 86400000;
  const sevenDays = oneDay * 7;

  const todayList = unpinned.filter((c) => now - c.updatedAt < oneDay);
  const pastWeekList = unpinned.filter((c) => now - c.updatedAt >= oneDay && now - c.updatedAt < sevenDays);
  const olderList = unpinned.filter((c) => now - c.updatedAt >= sevenDays);

  const renderConversationItem = (conv: Conversation) => {
    const isActive = conv.id === activeId;
    const isEditing = editingId === conv.id;

    return (
      <div
        key={conv.id}
        id={`conv-item-${conv.id}`}
        onClick={() => {
          onSelect(conv.id);
          onCloseMobile();
        }}
        className={`group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 cursor-pointer ${
          isActive
            ? 'bg-indigo-600/15 text-indigo-200 border border-indigo-500/30 shadow-xs'
            : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
        }`}
      >
        <MessageSquare
          className={`w-4 h-4 shrink-0 ${
            isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-300'
          }`}
        />

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <form
              onSubmit={(e) => handleSaveEdit(conv.id, e)}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                autoFocus
                value={editTitleText}
                onChange={(e) => setEditTitleText(e.target.value)}
                onBlur={() => handleSaveEdit(conv.id)}
                className="w-full bg-slate-900 px-2 py-0.5 text-xs text-white border border-indigo-500/50 rounded-sm focus:outline-hidden"
              />
              <button
                type="submit"
                className="p-1 text-emerald-400 hover:text-emerald-300"
                title="Save"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <div className="truncate font-medium leading-snug">
              {conv.title}
            </div>
          )}
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              id={`btn-pin-${conv.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(conv.id);
              }}
              className={`p-1 rounded-sm hover:bg-slate-700/60 ${
                conv.isPinned ? 'text-amber-400 opacity-100' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={conv.isPinned ? 'Unpin' : 'Pin'}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
            <button
              id={`btn-edit-${conv.id}`}
              onClick={(e) => handleStartEdit(conv, e)}
              className="p-1 text-slate-400 hover:text-slate-200 rounded-sm hover:bg-slate-700/60"
              title="Rename"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              id={`btn-del-${conv.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="p-1 text-slate-400 hover:text-rose-400 rounded-sm hover:bg-slate-700/60"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <aside
      id="jenna-sidebar"
      className="flex flex-col h-full bg-slate-900/95 border-r border-slate-800/80 w-72 shrink-0 select-none backdrop-blur-md"
    >
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 shadow-md shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white" />
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-slate-900 rounded-full" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold tracking-tight text-white text-base">Jenna</span>
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Phase 1
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-normal">Personal AI Assistant</p>
          </div>
        </div>

        {/* Platform Indicator */}
        <button
          id="btn-toggle-platform"
          onClick={() => {
            const nextMode =
              settings.platform.mode === 'web_desktop'
                ? 'android_companion'
                : 'web_desktop';
            onUpdateSettings({ platform: { mode: nextMode } });
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-xs text-slate-300 border border-slate-700/60 transition-colors"
          title={`Active preview: ${settings.platform.mode}. Click to toggle.`}
        >
          {settings.platform.mode === 'android_companion' ? (
            <>
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px]">Android</span>
            </>
          ) : (
            <>
              <Monitor className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[11px]">Web</span>
            </>
          )}
        </button>
      </div>

      {/* New Chat Button */}
      <div className="p-3 border-b border-slate-800/60">
        <button
          id="btn-new-chat"
          onClick={() => {
            onNew();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-sm transition-all duration-150 shadow-sm shadow-indigo-600/25 group cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
            <span>New Conversation</span>
          </div>
          <span className="text-[10px] bg-indigo-700/60 px-1.5 py-0.5 rounded-md font-mono text-indigo-200">
            ⌘K
          </span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-3 pt-3 pb-1">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="input-search-conversations"
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-800 focus:border-indigo-500/50 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-400 focus:outline-hidden transition-colors"
          />
        </div>
      </div>

      {/* Conversations Scroll Area */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {pinned.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">
              <Pin className="w-3 h-3" />
              <span>Pinned</span>
            </div>
            <div className="space-y-0.5 mt-1">{pinned.map(renderConversationItem)}</div>
          </div>
        )}

        {todayList.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Today
            </div>
            <div className="space-y-0.5 mt-1">{todayList.map(renderConversationItem)}</div>
          </div>
        )}

        {pastWeekList.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Previous 7 Days
            </div>
            <div className="space-y-0.5 mt-1">{pastWeekList.map(renderConversationItem)}</div>
          </div>
        )}

        {olderList.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Older
            </div>
            <div className="space-y-0.5 mt-1">{olderList.map(renderConversationItem)}</div>
          </div>
        )}

        {filteredConversations.length === 0 && (
          <div className="text-center py-8 text-xs text-slate-400">
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </div>
        )}
      </div>

      {/* Persistent Bottom Hub */}
      <div className="p-2 border-t border-slate-800/80 bg-slate-950/40 space-y-1">
        {/* User Identity & Session Pill */}
        <button
          id="btn-user-profile-hub"
          onClick={onOpenSettings}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-slate-300 hover:bg-slate-800/70 hover:text-white transition-colors group border border-slate-800/60 bg-slate-900/40 mb-1"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-[11px] shrink-0">
              {(settings.profile?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="text-left truncate min-w-0">
              <div className="font-semibold text-slate-200 text-xs truncate">
                {settings.profile?.name || 'User'}
              </div>
              <div className="text-[10px] text-slate-400 truncate font-mono">
                {settings.profile?.handle || '@user'}
              </div>
            </div>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-950 shrink-0" title="Active Local Session" />
        </button>

        {/* Long-Term Memory Hub Button */}
        <button
          id="btn-memory-hub"
          onClick={onOpenMemory}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-slate-300 hover:bg-slate-800/70 hover:text-white transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20">
              <Brain className="w-3.5 h-3.5" />
            </div>
            <span className="font-medium">Long-Term Memory</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {memoryCount} facts
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
        </button>

        {/* Verification & Diagnostics */}
        <button
          id="btn-diagnostics-hub"
          onClick={onOpenDiagnostics}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-slate-300 hover:bg-slate-800/70 hover:text-white transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20">
              <Activity className="w-3.5 h-3.5" />
            </div>
            <span className="font-medium">Phase 1 Verification</span>
          </div>
          <span className="text-[10px] text-emerald-400 font-medium">Ready</span>
        </button>

        {/* Settings Button */}
        <button
          id="btn-settings-hub"
          onClick={onOpenSettings}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-slate-300 hover:bg-slate-800/70 hover:text-white transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-slate-700/40 text-slate-400 group-hover:bg-slate-700/60 group-hover:text-slate-200">
              <Settings className="w-3.5 h-3.5" />
            </div>
            <span className="font-medium">Settings & Persona</span>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop View */}
      <div className="hidden md:block h-full">{sidebarContent}</div>

      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 w-4/5 max-w-xs h-full animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
