import React, { useEffect, useState } from 'react';
import {
  Archive,
  BookmarkPlus,
  BookOpen,
  Download,
  Edit3,
  Eye,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { apiDownload, apiFetch, formatDate, formatInr, type AuthUser } from '../lib/api';
import { syncBookToFirestore } from '../lib/firebase';

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || query.trim().length < 2) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text || '').split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, idx) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark key={idx} className="rounded bg-cyan-100 px-0.5 text-[#0f294d] dark:bg-cyan-900/60 dark:text-cyan-200">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function CatalogueView({
  user,
  mode = 'catalogue',
  initialQuery = '',
}: {
  user: AuthUser;
  mode?: 'catalogue' | 'advanced-search';
  initialQuery?: string;
}) {
  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'LIBRARIAN';
  const [books, setBooks] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [year, setYear] = useState('');
  const [edition, setEdition] = useState('');
  const [availability, setAvailability] = useState('');
  const [sort, setSort] = useState('newest');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editingBook, setEditingBook] = useState<any | null>(null);
  const [detailData, setDetailData] = useState<{ book: any; copies: any[] } | null>(null);

  const [formState, setFormState] = useState({
    title: '',
    subtitle: '',
    isbn: '',
    author: '',
    editor: '',
    publisher: '',
    edition: '1st Edition',
    publicationYear: String(new Date().getFullYear()),
    language: 'English',
    category: 'Structural Engineering',
    subject: '',
    subcategory: '',
    keywords: '',
    description: '',
    initialCopies: '1',
    purchasePriceInr: '750',
    supplier: 'Kolkata Academic Book House',
    invoiceNumber: '',
    fundingSource: 'Departmental Annual Grant',
    shelfNumber: 'S-01',
    rackNumber: 'R-01',
  });

  useEffect(() => {
    if (initialQuery) setQ(initialQuery);
  }, [initialQuery]);

  const loadTaxonomy = async () => {
    try {
      const tax = await apiFetch('/api/taxonomy');
      setCategories(tax.categories || []);
    } catch {
      // ignore
    }
  };

  const loadBooks = async (targetPage = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: '20',
        sort,
      });
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (author.trim()) params.set('author', author.trim());
      if (publisher.trim()) params.set('publisher', publisher.trim());
      if (year.trim()) params.set('year', year.trim());
      if (edition.trim()) params.set('edition', edition.trim());
      if (availability) params.set('availability', availability);
      if (includeArchived) params.set('includeArchived', 'true');

      const res = await apiFetch(`/api/books?${params.toString()}`);
      setBooks(res.items || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTaxonomy();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadBooks(1);
      setPage(1);
    }, 180);
    return () => clearTimeout(t);
  }, [q, category, author, publisher, year, edition, availability, sort, includeArchived]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/books/suggestions?q=${encodeURIComponent(q.trim())}`);
        setSuggestions(res.suggestions || []);
      } catch {
        setSuggestions([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const openAddModal = () => {
    setEditingBook(null);
    setFormState({
      title: '',
      subtitle: '',
      isbn: '',
      author: '',
      editor: '',
      publisher: '',
      edition: '1st Edition',
      publicationYear: String(new Date().getFullYear()),
      language: 'English',
      category: categories[0]?.name || 'Structural Engineering',
      subject: '',
      subcategory: '',
      keywords: '',
      description: '',
      initialCopies: '1',
      purchasePriceInr: '750',
      supplier: 'Kolkata Academic Book House',
      invoiceNumber: '',
      fundingSource: 'Departmental Annual Grant',
      shelfNumber: 'S-01',
      rackNumber: 'R-01',
    });
    setShowForm(true);
  };

  const openEditModal = (book: any) => {
    setEditingBook(book);
    setFormState({
      title: book.title || '',
      subtitle: book.subtitle || '',
      isbn: book.isbn || '',
      author: book.author || '',
      editor: book.editor || '',
      publisher: book.publisher || '',
      edition: book.edition || '1st Edition',
      publicationYear: String(book.publication_year || new Date().getFullYear()),
      language: book.language || 'English',
      category: book.category || 'Structural Engineering',
      subject: book.subject || '',
      subcategory: book.subcategory || '',
      keywords: book.keywords || '',
      description: book.description || '',
      initialCopies: '0',
      purchasePriceInr: '0',
      supplier: '',
      invoiceNumber: '',
      fundingSource: '',
      shelfNumber: 'S-01',
      rackNumber: 'R-01',
    });
    setShowForm(true);
  };

  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      if (editingBook) {
        await apiFetch(`/api/books/${editingBook.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: formState.title,
            subtitle: formState.subtitle,
            isbn: formState.isbn || null,
            author: formState.author,
            editor: formState.editor,
            publisher: formState.publisher,
            edition: formState.edition,
            publicationYear: Number(formState.publicationYear) || null,
            language: formState.language,
            category: formState.category,
            subject: formState.subject || formState.category,
            subcategory: formState.subcategory,
            keywords: formState.keywords,
            description: formState.description,
          }),
        });
        setFeedback({ type: 'ok', text: `Updated book "${formState.title}".` });
      } else {
        const res = await apiFetch('/api/books', {
          method: 'POST',
          body: JSON.stringify({
            ...formState,
            publicationYear: Number(formState.publicationYear) || new Date().getFullYear(),
            initialCopies: Number(formState.initialCopies) || 0,
            purchasePriceInr: Number(formState.purchasePriceInr) || 0,
            subject: formState.subject || formState.category,
          }),
        });
        // Non-blocking Firestore cloud mirror if Google signed in
        void syncBookToFirestore({
          id: res.bookId,
          bookCode: res.bookCode,
          isbn: formState.isbn,
          title: formState.title,
          author: formState.author,
          publisher: formState.publisher,
          category: formState.category,
          subject: formState.subject || formState.category,
          publicationYear: Number(formState.publicationYear) || new Date().getFullYear(),
          totalCopies: res.copiesCreated?.length || 0,
          availableCopies: res.copiesCreated?.length || 0,
          archived: false,
        }).catch(() => {});

        const accList = res.copiesCreated?.map((c: any) => c.accessionNumber).join(', ');
        setFeedback({
          type: 'ok',
          text: `Created book "${formState.title}" (${res.bookCode})${
            accList ? ` with accession numbers: ${accList}` : ''
          }.`,
        });
      }
      setShowForm(false);
      await loadBooks(1);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleReserve = async (bookId: number, title: string) => {
    setFeedback(null);
    try {
      const res = await apiFetch('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({ bookId }),
      });
      setFeedback({
        type: 'ok',
        text: `Reserved "${title}" — Status: ${res.status} (Queue #${res.position}).`,
      });
      await loadBooks(page);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleArchiveToggle = async (book: any) => {
    try {
      await apiFetch(`/api/books/${book.id}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !book.archived }),
      });
      setFeedback({
        type: 'ok',
        text: book.archived ? `Restored "${book.title}".` : `Archived "${book.title}".`,
      });
      await loadBooks(page);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const openDetails = async (bookId: number) => {
    try {
      const res = await apiFetch(`/api/books/${bookId}`);
      setDetailData(res);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {mode === 'advanced-search' ? 'Advanced Catalogue Search' : 'Book Catalogue Management'}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {total} Civil Engineering titles indexed · Physical copies tracked individually in the Accession Register.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isStaff && (
            <>
              <button
                type="button"
                onClick={() => void apiDownload('/api/excel/export/catalogue', 'HIT-CE-Book-Catalogue.xlsx')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Export Excel
              </button>
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Book Title
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search & Multi-Facet Filter Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-5">
            <label htmlFor="catalogue-search" className="sr-only">
              Search books by title, author, ISBN, accession number, subject, or keywords
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="catalogue-search"
              type="text"
              value={q}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, author, ISBN, accession no., subject, keywords..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-[#1d4ed8] dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={() => {
                      setQ(s.title);
                      setShowSuggestions(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="truncate font-medium text-slate-900 dark:text-slate-100">{s.title}</span>
                    <span className="ml-2 shrink-0 text-slate-500">{s.author}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filter by Civil Engineering category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="">All Categories ({categories.length})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filter by availability"
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="">All Availability</option>
              <option value="AVAILABLE">Available Now</option>
              <option value="UNAVAILABLE">All Copies Out</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Sort results"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="newest">Newest Added</option>
              <option value="title_asc">Title (A → Z)</option>
              <option value="title_desc">Title (Z → A)</option>
              <option value="year_desc">Publication Year</option>
              <option value="author_asc">Author (A → Z)</option>
            </select>
          </div>
        </div>

        {/* Extended Filters for Advanced Search */}
        {mode === 'advanced-search' && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-4">
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Filter by Author"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="text"
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              placeholder="Filter by Publisher"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="text"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="Publication Year (e.g. 2024)"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="text"
              value={edition}
              onChange={(e) => setEdition(e.target.value)}
              placeholder="Edition (e.g. 5th Edition)"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        )}

        {isStaff && (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="rounded border-slate-300"
              />
              Show archived book titles
            </label>
            {(q || category || author || publisher || year || edition || availability) && (
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  setCategory('');
                  setAuthor('');
                  setPublisher('');
                  setYear('');
                  setEdition('');
                  setAvailability('');
                }}
                className="font-medium text-[#1d4ed8] hover:underline dark:text-cyan-400"
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Catalogue Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                <th className="px-4 py-3">Book ID & ISBN</th>
                <th className="px-4 py-3">Title & Author</th>
                <th className="px-4 py-3">Category / Subject</th>
                <th className="px-4 py-3">Edition / Year</th>
                <th className="px-4 py-3 text-right">Copies</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading Civil Engineering catalogue...
                  </td>
                </tr>
              ) : books.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    No matching book titles found. Try clearing filters or add a new book title.
                  </td>
                </tr>
              ) : (
                books.map((book) => (
                  <tr
                    key={book.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 erp-transition"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-xs font-semibold text-[#0f294d] dark:text-cyan-400">
                        {book.book_code}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {book.isbn ? highlightMatch(book.isbn, q) : 'No ISBN'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {highlightMatch(book.title, q)}
                        {book.archived ? (
                          <span className="ml-2 text-xs font-normal text-amber-600">(Archived)</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                        {highlightMatch(book.author, q)} · {book.publisher}
                        {book.is_demo_data ? ' · Sample Data' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{book.category}</div>
                      <div className="text-slate-500 dark:text-slate-400">{book.subject}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-600 dark:text-slate-300">
                      <div>{book.edition || '1st Ed.'}</div>
                      <div className="font-mono text-slate-500">{book.publication_year || '—'}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono text-xs">
                      <div
                        className={`font-semibold ${
                          book.available_copies > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {book.available_copies} / {book.total_copies}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {book.available_copies > 0 ? 'Available' : 'Checked Out'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void openDetails(book.id)}
                          aria-label={`View details for ${book.title}`}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {isStaff ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(book)}
                              aria-label={`Edit ${book.title}`}
                              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleArchiveToggle(book)}
                              aria-label={`${book.archived ? 'Restore' : 'Archive'} ${book.title}`}
                              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleReserve(book.id, book.title)}
                            className="inline-flex items-center gap-1 rounded-md bg-[#0f294d] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            Reserve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
          <span>
            Page <strong className="font-mono">{page}</strong> of <strong className="font-mono">{totalPages}</strong> ·{' '}
            <strong className="font-mono">{total}</strong> titles
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                const next = page - 1;
                setPage(next);
                void loadBooks(next);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40 dark:border-slate-700"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void loadBooks(next);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40 dark:border-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Book Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingBook ? `Edit Book: ${editingBook.book_code}` : 'Register New Civil Engineering Book Title'}
              </h2>
              <button type="button" onClick={() => setShowForm(false)} aria-label="Close modal">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleSaveBook} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Book Title *
                </label>
                <input
                  required
                  value={formState.title}
                  onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">ISBN</label>
                <input
                  value={formState.isbn}
                  onChange={(e) => setFormState({ ...formState, isbn: e.target.value })}
                  placeholder="978-81-..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Author *</label>
                <input
                  required
                  value={formState.author}
                  onChange={(e) => setFormState({ ...formState, author: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Publisher *</label>
                <input
                  required
                  value={formState.publisher}
                  onChange={(e) => setFormState({ ...formState, publisher: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Category *</label>
                <select
                  value={formState.category}
                  onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Subject *</label>
                <input
                  required
                  value={formState.subject}
                  onChange={(e) => setFormState({ ...formState, subject: e.target.value })}
                  placeholder="e.g., Bridge Hydraulics"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Edition</label>
                <input
                  value={formState.edition}
                  onChange={(e) => setFormState({ ...formState, edition: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Publication Year</label>
                <input
                  type="number"
                  value={formState.publicationYear}
                  onChange={(e) => setFormState({ ...formState, publicationYear: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Keywords</label>
                <input
                  value={formState.keywords}
                  onChange={(e) => setFormState({ ...formState, keywords: e.target.value })}
                  placeholder="comma-separated academic keywords"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {!editingBook && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60 sm:col-span-2">
                  <div className="text-xs font-semibold text-[#0f294d] dark:text-cyan-400">
                    Initial Physical Copies (Auto-generates unique Accession Numbers, Barcodes & QR Codes)
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400">Copies Count</label>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={formState.initialCopies}
                        onChange={(e) => setFormState({ ...formState, initialCopies: e.target.value })}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400">Price (INR)</label>
                      <input
                        type="number"
                        min={0}
                        value={formState.purchasePriceInr}
                        onChange={(e) => setFormState({ ...formState, purchasePriceInr: e.target.value })}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400">Shelf No.</label>
                      <input
                        value={formState.shelfNumber}
                        onChange={(e) => setFormState({ ...formState, shelfNumber: e.target.value })}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400">Rack No.</label>
                      <input
                        value={formState.rackNumber}
                        onChange={(e) => setFormState({ ...formState, rackNumber: e.target.value })}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Description</label>
                <textarea
                  rows={2}
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173a6b]"
                >
                  {editingBook ? 'Save Changes' : 'Create Book Title'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Book Detail & Copies Modal */}
      {detailData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 font-mono text-xs text-[#0891b2]">
                  <BookOpen className="h-4 w-4" />
                  <span>{detailData.book.book_code}</span>
                  <span>·</span>
                  <span>ISBN {detailData.book.isbn || 'N/A'}</span>
                </div>
                <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{detailData.book.title}</h2>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                  {detailData.book.author} · {detailData.book.publisher} · {detailData.book.edition} ({detailData.book.publication_year})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button type="button" onClick={() => setDetailData(null)} aria-label="Close detail modal">
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div>
                <span className="text-slate-500">Category</span>
                <div className="font-semibold text-slate-900 dark:text-white">{detailData.book.category}</div>
              </div>
              <div>
                <span className="text-slate-500">Subject</span>
                <div className="font-semibold text-slate-900 dark:text-white">{detailData.book.subject}</div>
              </div>
              <div>
                <span className="text-slate-500">Language</span>
                <div className="font-semibold text-slate-900 dark:text-white">{detailData.book.language}</div>
              </div>
            </div>

            {detailData.book.description && (
              <p className="mt-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {detailData.book.description}
              </p>
            )}

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Individual Physical Book Copies ({detailData.copies.length})
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Accession No.</th>
                      <th className="px-3 py-2 font-semibold">Copy #</th>
                      <th className="px-3 py-2 font-semibold">Shelf / Rack</th>
                      <th className="px-3 py-2 font-semibold">Acq. Date</th>
                      <th className="px-3 py-2 font-semibold">Price</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {detailData.copies.map((c: any) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2 font-mono font-semibold text-[#0f294d] dark:text-cyan-400">
                          {c.accession_number}
                        </td>
                        <td className="px-3 py-2 font-mono">#{c.copy_number}</td>
                        <td className="px-3 py-2 font-mono">
                          {c.shelf_number} / {c.rack_number}
                        </td>
                        <td className="px-3 py-2 font-mono">{formatDate(c.acquisition_date)}</td>
                        <td className="px-3 py-2 font-mono">{formatInr(c.purchase_price_inr)}</td>
                        <td className="px-3 py-2 font-semibold">{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
