const octokit = require('@octokit/rest')()

module.exports = async function ({ data, body }, done) {
  // eslint-disable-next-line camelcase
  const { repository, pull_request } = body
  const { owner: { login }, name } = repository

  try {
    if (WIP_CHECK.includes(body.action)) {
      console.log('OK')
    }

    done(null, { result: 'WIP hook Success' })
  } catch (err) {
    console.log('err', err)
    done(err)
  }
}
