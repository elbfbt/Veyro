import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePreferences } from '../../state/PreferencesContext';
import type { ContentRow as ContentRowType } from '../../types/domain';
import { MediaCard } from './MediaCard';

export function ContentRow({ row }: { row: ContentRowType }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { preferences } = usePreferences();

  const scroll = (direction: 1 | -1) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * 0.82,
      behavior: preferences.motion === 'reduced' ? 'instant' : 'smooth',
    });
  };

  return (
    <section className="content-row" aria-labelledby={`row-${row.id}`}>
      <div className="content-row__head">
        <h2 id={`row-${row.id}`}>{row.title}</h2>
        <div className="content-row__head-actions">
          <Link to="/library" className="content-row__more">
            See all
          </Link>
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={() => scroll(-1)}
            aria-label={`Scroll ${row.title} left`}
            data-spatial={`row-${row.id}-prev`}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={() => scroll(1)}
            aria-label={`Scroll ${row.title} right`}
            data-spatial={`row-${row.id}-next`}
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </div>
      <div className="content-row__scroller" ref={scroller}>
        {row.items.map((item) => (
          <MediaCard
            key={`${row.id}-${item.id}`}
            item={item}
            spatialId={`row-${row.id}-card-${item.id}`}
            showProgress={row.id === 'continue' || row.id === 'recent'}
          />
        ))}
      </div>
    </section>
  );
}
