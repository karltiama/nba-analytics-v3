'use client';

import { useState } from 'react';
import { 
  Sun, 
  Moon, 
  Calendar, 
  User, 
  ChevronLeft, 
  ChevronRight,
  Zap
} from 'lucide-react';

interface HeaderProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  isDarkMode: boolean;
  onThemeToggle: () => void;
}

export function Header({ selectedDate, onDateChange, isDarkMode, onThemeToggle }: HeaderProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const goToPreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    onDateChange(newDate);
  };

  const goToNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    onDateChange(newDate);
  };

  const goToToday = () => {
    onDateChange(new Date());
  };

  const isToday = selectedDate.toDateString() === new Date().toDateString();

  return (
    <header className="sticky top-0 z-50 glass-card border-b border-white/5">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#39ff14] rounded-full pulse-dot" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="neon-text-cyan">NBA</span>
                <span className="text-white ml-1">Betting Dashboard</span>
              </h1>
              <p className="text-xs text-muted-foreground -mt-0.5">Live odds & AI insights</p>
            </div>
          </div>

          {/* Date Selector */}
          <div className="flex items-center gap-2 bg-secondary/50 rounded-xl p-1">
            <button
              onClick={goToPreviousDay}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors min-w-[140px] justify-center"
            >
              <Calendar className="w-4 h-4 text-[#00d4ff]" />
              <span className="text-sm font-medium">{formatDate(selectedDate)}</span>
              {isToday && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[#39ff14]/20 text-[#39ff14] rounded-full font-semibold">
                  TODAY
                </span>
              )}
            </button>

            <button
              onClick={goToNextDay}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              aria-label="Next day"
            >
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>

            {!isToday && (
              <button
                onClick={goToToday}
                className="px-3 py-1.5 text-xs font-medium text-[#00d4ff] hover:bg-[#00d4ff]/10 rounded-lg transition-colors"
              >
                Today
              </button>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              onClick={onThemeToggle}
              className="p-2.5 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
              aria-label="Toggle theme"
            >
              {isDarkMode ? (
                <Sun className="w-4 h-4 text-[#ff6b35]" />
              ) : (
                <Moon className="w-4 h-4 text-[#bf5af2]" />
              )}
            </button>

            {/* User Account */}
            <button
              className="flex items-center gap-2 p-2 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
              aria-label="User account"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#ff00ff] to-[#00d4ff] flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

