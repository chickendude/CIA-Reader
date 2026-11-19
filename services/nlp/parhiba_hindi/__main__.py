"""Run one dictionary operation for the Parhiba web server."""

import json
import sys
from urllib.error import URLError

from .database import DatabaseLexicon
from .dictionary import ReportNotFoundError, preview, reference, workshop_report


def main():
    request = json.load(sys.stdin)
    try:
        match sys.argv[1]:
            case "preview":
                result = preview(request["entry"], **request["options"])
            case "reference":
                result = reference(**request)
            case "report":
                result = workshop_report(request["name"], DatabaseLexicon())
            case _:
                raise ValueError("Unknown Hindi dictionary operation")
    except ReportNotFoundError as exc:
        response = {"status": 404, "message": str(exc)}
    except (KeyError, TypeError, ValueError, URLError, TimeoutError) as exc:
        response = {"status": 400, "message": str(exc)}
    else:
        response = {"status": 200, "result": result}
    json.dump(response, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
