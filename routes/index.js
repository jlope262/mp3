/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, router) {
    require('./home.js')(router);
    require('./users.js')(router);
    require('./tasks.js')(router);
    //all of the routes are prefixed with /api, we learned this
    app.use('/api', router);
};
