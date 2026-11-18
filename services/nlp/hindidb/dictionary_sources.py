"""Persistent dictionary evidence. Nothing here changes the active parser lexicon."""

import hashlib
from html.parser import HTMLParser
import json
from urllib.parse import quote, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener

from .text import normalize

HOSTS = {"hindwidictionary.com", "www.hindwidictionary.com",
         "rekhtadictionary.com", "www.rekhtadictionary.com"}
MAX_PAGE = 4 * 1024 * 1024
PROVIDERS = {"hindwi": "https://www.hindwidictionary.com",
             "rekhta": "https://www.rekhtadictionary.com"}
DICTIONARY_DOMAINS = ['hindwidictionary.com', 'rekhtadictionary.com',
                      'hi.wiktionary.org', 'en.wiktionary.org', 'shabdkosh.com']


def dictionary_url(url):
    parts = urlsplit(url.strip())
    path = unquote(parts.path)
    wiki = parts.hostname in {'hi.wiktionary.org', 'en.wiktionary.org'}
    allowed = ((parts.hostname in HOSTS and path.startswith('/meaning-of-')) or
               (wiki and path.startswith('/wiki/') and len(path) > len('/wiki/')) or
               (parts.hostname in {'shabdkosh.com', 'www.shabdkosh.com'} and
                path.startswith(('/dictionary/english-hindi/', '/dictionary/hindi-english/'))))
    if (parts.scheme != "https" or not allowed or
            parts.username or parts.password or parts.port not in {None, 443} or
            any(segment in {'.', '..'} for segment in path.split('/'))):
        raise ValueError("Use an HTTPS Hindwi, Rekhta, Wiktionary or Shabdkosh dictionary entry URL")
    # Unicode titles are valid dictionary URLs, but urllib needs an ASCII URL.
    return urlunsplit(("https", parts.hostname, quote(path, safe='/:-._~@'),
                       quote(parts.query, safe='=&%+-._~'),
                       quote(unquote(parts.fragment), safe='-._~') if wiki else ''))


def dictionary_provider(url):
    host = urlsplit(dictionary_url(url)).hostname.removeprefix('www.')
    return {'hindwidictionary.com': 'hindwi', 'rekhtadictionary.com': 'rekhta',
            'hi.wiktionary.org': 'wiktionary', 'en.wiktionary.org': 'wiktionary',
            'shabdkosh.com': 'shabdkosh'}[host]


class DictionaryRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        dictionary_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class SearchRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urlsplit(newurl)
        if (parts.scheme != "https" or parts.hostname not in HOSTS or
                parts.username or parts.password or parts.port not in {None, 443} or
                parts.path != "/GetWordsSuggestions"):
            raise ValueError("Unexpected dictionary search redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def search_dictionary(provider, query):
    """Use the sites' own Hindi autocomplete results; never invent an entry slug."""
    base = PROVIDERS[provider]
    url = base + "/GetWordsSuggestions?" + urlencode({"q": query, "lang": 2})
    request = Request(url, headers={"User-Agent": "HindiDB/0.1 (local dictionary review)",
                                   "Accept": "application/json"})
    with build_opener(SearchRedirect()).open(request, timeout=15) as response:
        raw = response.read(MAX_PAGE + 1)
    if len(raw) > MAX_PAGE:
        raise ValueError("Dictionary search response exceeds 4 MiB")
    return parse_suggestions(provider, query, json.loads(raw))


def parse_suggestions(provider, query, suggestions):
    if not isinstance(suggestions, list):
        raise ValueError("Dictionary returned an unexpected search response")
    results = {}
    for item in suggestions:
        if not isinstance(item, dict) or not isinstance(item.get("word"), str) or not isinstance(item.get("slug"), str):
            raise ValueError("Dictionary search result is missing its headword or entry slug")
        # Slugs are source-supplied path segments, never arbitrary URLs.
        slug = item["slug"]
        if not slug or any(c in slug for c in "/\\?#") or ":" in slug:
            raise ValueError("Dictionary returned an invalid entry slug")
        headword = item["word"].split(" [", 1)[0].strip()
        url = dictionary_url(PROVIDERS[provider] + "/meaning-of-" + quote(slug, safe="-._~") + "?lang=hi")
        results[url] = {"provider": provider, "headword": headword, "label": item["word"],
                        "source_url": url, "exact": normalize(headword) == normalize(query)}
    return sorted(results.values(), key=lambda row: not row["exact"])


class PageText(HTMLParser):
    """Extract inert readable evidence, never executable remote HTML."""
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip += 1
        elif tag in {"p", "li", "h1", "h2", "h3", "div", "br"} and not self.skip:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def text(self):
        return "\n".join(line for raw in "".join(self.parts).splitlines()
                         if (line := " ".join(raw.split())))


def fetch_page(url):
    opener = build_opener(DictionaryRedirect())
    request = Request(dictionary_url(url), headers={"User-Agent": "HindiDB/0.1 (local dictionary review)"})
    with opener.open(request, timeout=20) as response:
        final_url = dictionary_url(response.url)
        if response.headers.get_content_type() != "text/html":
            raise ValueError("Dictionary returned a non-HTML response")
        raw = response.read(MAX_PAGE + 1)
        if len(raw) > MAX_PAGE:
            raise ValueError("Dictionary page exceeds 4 MiB")
        parser = PageText()
        parser.feed(raw.decode(response.headers.get_content_charset() or "utf-8"))
        text = parser.text()
        if len(text) < 40:
            raise ValueError("No readable dictionary text; paste the source excerpt instead")
        return {"text": text, "final_url": final_url,
                "content_hash": hashlib.sha256(raw).hexdigest()}
