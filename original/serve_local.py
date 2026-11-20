"""Local test server: serves this folder and proxies /zapi/* to api.zappy5.com (same as vercel.json)."""
import http.server, urllib.request, sys
class H(http.server.SimpleHTTPRequestHandler):
    def _proxy(self):
        body=self.rfile.read(int(self.headers.get('Content-Length',0) or 0)) if self.command!='GET' else None
        req=urllib.request.Request('https://api.zappy5.com'+self.path[5:],data=body,method=self.command,headers={k:v for k,v in self.headers.items() if k.lower() in('content-type','authorization','accept')}|{'User-Agent':'Mozilla/5.0'})
        try: r=urllib.request.urlopen(req,timeout=30); code,data,ct=r.status,r.read(),r.headers.get('Content-Type','application/json')
        except urllib.error.HTTPError as e: code,data,ct=e.code,e.read(),e.headers.get('Content-Type','application/json')
        self.send_response(code);self.send_header('Content-Type',ct);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self): self._proxy() if self.path.startswith('/zapi/') else super().do_GET()
    def do_POST(self): self._proxy()
    def do_PUT(self): self._proxy()
    def do_DELETE(self): self._proxy()
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1]) if len(sys.argv)>1 else 8767),H).serve_forever()
