const error = next => {
  const error = new Error('Unauthorized App')
  error.statusCode = 401

  return next(error)
}

module.exports = () => ({ webtaskContext }, res, next) => {
  const { secrets } = webtaskContext

  if (!secrets.HOOK_SECRET) {
    return error(next)
  }

  return next()
}
