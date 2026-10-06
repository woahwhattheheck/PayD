import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';

const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <button
      onClick={toggleTheme}
      aria-label={t(theme === 'dark' ? 'themeToggle.switchToLight' : 'themeToggle.switchToDark')}
      className="p-2 rounded-lg border border-(--border-hi) text-(--muted) hover:text-(--text) hover:bg-(--surface-hi) transition-colors"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};

export default ThemeToggle;
