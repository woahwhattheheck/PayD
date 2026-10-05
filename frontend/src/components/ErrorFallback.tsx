import { Icon } from '@stellar/design-system';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type ErrorFallbackProps = {
  title?: string;
  description?: string;
  onReset?: () => void;
};

export default function ErrorFallback({ title, description, onReset }: ErrorFallbackProps) {
  const { t } = useTranslation();

  const resolvedTitle = title ?? t('errorFallback.defaultTitle');
  const resolvedDescription = description ?? t('errorFallback.defaultDescription');

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="card glass noise max-w-md w-full text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 border border-danger/20">
          <Icon.AlertTriangle size="lg" className="text-danger" />
        </div>
        <h2 className="text-2xl font-bold mb-2">{resolvedTitle}</h2>
        <p className="text-muted text-sm mb-6">{resolvedDescription}</p>
        <div className="flex items-center justify-center gap-3">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="px-4 py-2 rounded-full bg-accent text-on-accent font-semibold text-sm hover:bg-accent-hover transition-colors"
            >
              {t('errorFallback.tryAgain')}
            </button>
          )}
          <Link
            to="/"
            className="px-4 py-2 rounded-lg border border-hi text-sm font-medium text-text hover:bg-(--surface-hi) transition-colors"
          >
            {t('errorFallback.goHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
