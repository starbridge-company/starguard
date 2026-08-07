export function unsafeHandler(req) {
  return eval(req.query.code);
}
