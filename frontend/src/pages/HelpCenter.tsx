import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

export default function HelpCenter() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const docs = [
    { category: t('helpCenter.faqs'), items: [
      { question: t('helpCenter.addEmployeeQuestion'), answer: t('helpCenter.addEmployeeAnswer') },
      { question: t('helpCenter.resetPasswordQuestion'), answer: t('helpCenter.resetPasswordAnswer') },
    ]},
    { category: t('helpCenter.stellarConcepts'), items: [
      { question: t('helpCenter.trustlineQuestion'), answer: t('helpCenter.trustlineAnswer') },
      { question: t('helpCenter.anchorQuestion'), answer: t('helpCenter.anchorAnswer') },
    ]},
    { category: t('helpCenter.troubleshooting'), items: [
      { question: t('helpCenter.payrollFailedQuestion'), answer: t('helpCenter.payrollFailedAnswer') },
      { question: t('helpCenter.employeeMissingQuestion'), answer: t('helpCenter.employeeMissingAnswer') },
    ]},
  ];
  const [openItem, setOpenItem] = useState<string | null>(null);

  const toggleItem = (id: string) => {
    setOpenItem(openItem === id ? null : id);
  };

  const filteredDocs = docs
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.question.toLowerCase().includes(search.toLowerCase()) ||
          item.answer.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">
            {t('helpCenter.titlePrefix')} <span className="text-(--accent)">{t('helpCenter.titleHighlight')}</span>
          </h1>
          <p className="text-(--muted) text-sm font-mono uppercase tracking-widest">
            {t('helpCenter.subtitle')}
          </p>
        </div>

        {/* Search */}
        <div className="mb-10">
          <input
            type="text"
            placeholder={t('helpCenter.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-5 py-3 rounded-xl bg-(--surface-hi) border border-(--border) focus:outline-none focus:ring-2 focus:ring-(--accent) text-sm transition"
          />
        </div>

        {/* Results */}
        {filteredDocs.length === 0 && (
          <p className="text-center text-(--muted)">{t('helpCenter.noResults')}</p>
        )}

        {/* Accordion Sections */}
        <div className="space-y-10">
          {filteredDocs.map((section) => (
            <div key={section.category}>
              <h2 className="text-lg font-bold mb-4 text-(--accent2) uppercase tracking-wide">
                {section.category}
              </h2>

              <div className="space-y-3">
                {section.items.map((item, idx) => {
                  const id = `${section.category}-${idx}`;
                  const isOpen = openItem === id;

                  return (
                    <div
                      key={id}
                      className="border border-(--border) rounded-xl bg-(--surface-hi) overflow-hidden"
                    >
                      <button
                        onClick={() => toggleItem(id)}
                        className="w-full flex items-center justify-between px-5 py-4 text-left font-medium hover:bg-(--surface-hi) transition"
                      >
                        <span>{item.question}</span>
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {isOpen && (
                        <div className="px-5 py-4 text-sm text-(--muted) leading-relaxed">
                          {item.answer}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
