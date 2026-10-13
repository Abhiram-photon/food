import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="fr-card mx-auto max-w-lg p-8 text-center">
      <h1 className="text-2xl font-bold text-stone-900">Page not found</h1>
      <p className="mt-2 text-sm text-stone-600">
        That listing, reservation or page does not exist — or it belongs to another organization.
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <Link to="/browse" className="fr-btn-primary">
          Browse listings
        </Link>
        <Link to="/" className="fr-btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}
