import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

type ArrowLinkProps = {
  children: React.ReactNode;
  className?: string;
} & (
  | { to: string; href?: never; onClick?: never }
  | { href: string; to?: never; onClick?: never }
  | { onClick: () => void; to?: never; href?: never }
);

/** Secondary call-to-action: text link with a trailing arrow (see `.link-arrow` in index.css). */
const ArrowLink: React.FC<ArrowLinkProps> = ({ children, className = '', ...props }) => {
  const classes = `link-arrow ${className}`.trim();
  const content = (
    <>
      {children}
      <ArrowRight className="w-4 h-4" aria-hidden="true" />
    </>
  );

  if ('to' in props && props.to) {
    return (
      <Link to={props.to} className={classes}>
        {content}
      </Link>
    );
  }

  if ('href' in props && props.href) {
    const external = /^https?:\/\//.test(props.href);
    return (
      <a
        href={props.href}
        className={classes}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={props.onClick} className={classes}>
      {content}
    </button>
  );
};

export default ArrowLink;
