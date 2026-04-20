// services/userRoutesService.js
class UserRoutesService {
  constructor(userService) {
    this.userService = userService;
  }

  getUserRoutes(chatId) {
    return this.userService.getUserRoutes(chatId);
  }

  getUserRouteById(chatId, routeId) {
    return this.userService.getUserRouteById(chatId, routeId);
  }
}


module.exports = UserRoutesService;