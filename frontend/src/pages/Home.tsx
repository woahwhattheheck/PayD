import { Icon } from '@stellar/design-system';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowLink from '../components/ArrowLink';

export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const features = [
    {
      icon: <Icon.CreditCard01 size="lg" />,
      tint: 'bg-accent/10 text-accent',
      title: t('home.card1Title'),
      body: t('home.card1Body'),
      to: '/payroll',
    },
    {
      icon: <Icon.Users01 size="lg" />,
      tint: 'bg-accent2/10 text-accent2',
      title: t('home.card2Title'),
      body: t('home.card2Body'),
      to: '/employee',
    },
    {
      icon: <Icon.ShieldTick size="lg" />,
      tint: 'bg-link/10 text-link',
      title: t('home.card3Title'),
      body: t('home.card3Body'),
      to: '/transactions',
    },
  ];

  return (
    <div className="flex flex-col items-center w-full">
      {/* Hero */}
      <section
        id="tour-welcome"
        className="flex flex-col items-center text-center max-w-4xl px-6 pt-12 pb-20 md:pt-20 md:pb-28"
      >
        <span className="eyebrow mb-6">{t('home.eyebrow')}</span>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold mb-6 leading-[1.08]">
          {t('home.titleLine1Prefix')}{' '}
          <span className="text-accent">{t('home.titleLine1Highlight')}</span>
          <br />
          {t('home.titleLine2Prefix')}{' '}
          <span className="text-accent2">{t('home.titleLine2Highlight')}</span>
          {t('home.titleLine2Suffix')}
        </h1>

        <p className="text-lg md:text-xl text-muted max-w-2xl mb-10 leading-relaxed">
          {t('home.tagline')}
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
          <button
            className="btn-primary"
            onClick={() => {
              void navigate('/payroll');
            }}
          >
            {t('home.ctaManagePayroll')}
          </button>
          <ArrowLink to="/employee">{t('home.ctaViewEmployees')}</ArrowLink>
        </div>
      </section>

      {/* Features */}
      <section className="w-full bg-surface-hi rounded-3xl px-6 py-16 md:px-12 md:py-20 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 text-left">
          {features.map((f) => (
            <div key={f.to} className="card flex flex-col">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${f.tint}`}
              >
                {f.icon}
              </div>
              <h3 className="text-xl font-bold mb-3">{f.title}</h3>
              <p className="text-muted text-sm leading-relaxed mb-6 flex-1">{f.body}</p>
              <ArrowLink to={f.to} className="text-sm self-start">
                {t('home.learnMore')}
              </ArrowLink>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
