// Simple test file to verify layout components work
import React from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';

// Mock data for testing
const mockProps = {
  currentView: 'dashboard' as const,
  activeApp: 'qwen' as const,
  visibleApps: {
    qwen: true,
    claude: true,
    opencode: true,
    openclaw: true,
    codex: true,
    gemini: true,
    cline: true,
  },
  onViewChange: () => {},
  onAppChange: () => {},
  enableLocalProxy: false,
};

export function TestLayout() {
  return (
    <div className="flex h-screen">
      <Sidebar {...mockProps} />
      <div className="flex-1 flex flex-col">
        <Header currentView="dashboard" activeApp="qwen">
          <button>Test Action</button>
        </Header>
        <main className="flex-1 p-6">
          <h1>Test Content</h1>
        </main>
      </div>
    </div>
  );
}