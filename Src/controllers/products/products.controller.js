import ExcelJS from "exceljs";
import { Op } from "sequelize";
import moment from "moment-timezone";
import { Admins, Products } from "../../models/realations.js";

export default {
  async create(req, res) {
    try {
      let { name, totalAmount, price } = req.body;

      if (!req.file) {
        return res
          .status(400)
          .json({ message: "productImage must not be empty", status: 400 });
      }

      let createdData = await Products.create({
        name,
        totalAmount,
        price,
        remainingAmount: totalAmount,
        productImage: `/${req.file.filename}`,
        adminId: req.admin.id,
      });

      res.status(201).json({
        createdData,
        message: "Product created successfully",
        status: 201,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },

  async find(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      const { count, rows } = await Products.findAndCountAll({
        where: {
          deleted: false,
        },
        include: [
          {
            model: Admins,
            attributes: ["id", "name", "lastName", "phoneNumber"],
          },
        ],
        limit,
        offset,
        order: [["createdAt", "DESC"]],
      });

      const totalPages = Math.ceil(count / limit);

      res.json({
        data: rows,
        meta: {
          totalItems: count,
          totalPages,
          currentPage: page,
          itemsPerPage: limit,
        },
        message: "Products fetched successfully",
        status: 200,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },

  async findById(req, res) {
    try {
      let { id } = req.params;

      let data = await Products.findByPk(id, {
        include: [
          {
            model: Admins,
            attributes: ["id", "name", "lastName", "phoneNumber"],
          },
        ],
      });

      if (!data || data.deleted) {
        return res.status(404).json({
          message: "Product not found",
          status: 404,
        });
      }

      if (data.actionsTaken) {
        const adminIds = [
          ...new Set(data.actionsTaken.map((action) => action.adminId)),
        ];

        // Barcha adminlarni bir so'rovda olish
        const admins = await Admins.findAll({
          where: { id: adminIds },
          attributes: ["id", "name", "lastName", "phoneNumber"],
        });

        // Adminlarni obyekt shaklida xaritalash
        const adminMap = admins.reduce((map, admin) => {
          map[admin.id] = admin;
          return map;
        }, {});

        // actionsTaken ma'lumotlariga admin ma'lumotlarini qo'shish
        const actionsTakenWithAdmins = data.actionsTaken.map((action) => ({
          ...action,
          adminInfo: adminMap[action.adminId] || null,
        }));

        data = {
          ...data.toJSON(),
          actionsTaken: actionsTakenWithAdmins,
        };
      }

      res.status(200).json({
        data,
        message: "Product fetched successfully",
        status: 200,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },

  async sell(req, res) {
    try {
      const { id } = req.params; // Mahsulot ID
      let { amount } = req.body; // Sotiladigan miqdor

      // `amount` ni raqamga o'zgartirish
      amount = parseInt(amount, 10);

      // Agar `amount` raqamga o'zgartirilsa va noto'g'ri bo'lsa, xatolik yuborish
      if (isNaN(amount)) {
        return res.status(400).json({
          message: "Noto'g'ri miqdor kiritildi",
          status: 400,
        });
      }

      // Mahsulotni olish va adminni biriktirish
      const product = await Products.findByPk(id, {
        include: [
          {
            model: Admins,
            attributes: ["id", "name"], // Faqat kerakli maydonlarni olish
          },
        ],
      });

      // Mahsulot mavjudligi va o‘chirilganligini tekshirish
      if (!product || product.deleted) {
        return res.status(404).json({
          message: "Mahsulot topilmadi yoki o‘chirilgan",
          status: 404,
        });
      }

      // Yetarli miqdorda mahsulot borligini tekshirish
      if (product.remainingAmount < amount) {
        return res.status(400).json({
          message: "Yetarli miqdorda mahsulot mavjud emas",
          status: 400,
          requestedAmount: amount,
          availableAmount: product.remainingAmount,
        });
      }

      // Sotish jarayonida mahsulot miqdorini yangilash
      const updatedRemainingAmount = product.remainingAmount - amount;
      const updatedQuantitySold = product.quantitySold + amount;

      // Yangi harakatni yaratish
      const newAction = {
        action: "sold", // Harakat turi
        numberOfSales: amount, // Sotilgan miqdor
        adminId: req.admin.id, // Admin ID
        timestamp: moment().tz("Asia/Tashkent").format(), // Vaqt
      };

      // `actionsTaken` massivini yangilash
      const updatedActions = [...(product.actionsTaken || []), newAction];

      // Mahsulotni yangilash
      await product.update(
        {
          remainingAmount: updatedRemainingAmount, // Qolgan miqdor
          quantitySold: updatedQuantitySold, // Sotilgan miqdor
          actionsTaken: updatedActions, // Yangilangan actions
        },
        {
          fields: [
            "remainingAmount",
            "quantitySold",
            "revenue",
            "actionsTaken",
          ], // Faqat kerakli maydonlarni yangilash
        }
      );

      // Javobni qaytarish
      return res.status(200).json({
        message: "Savdo muvaffaqiyatli amalga oshirildi",
        status: 200,
        updatedProduct: {
          id: product.id,
          name: product.name,
          remainingAmount: updatedRemainingAmount,
          quantitySold: updatedQuantitySold,
          actionsTaken: updatedActions,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },

  async delete(req, res) {
    try {
      const { id } = req.params;
      const product = await Products.findByPk(id);

      // Mahsulot mavjudligini va o'chirilganligini tekshirish
      if (!product || product.deleted) {
        return res.status(404).json({
          message: "Product not found",
          status: 404,
        });
      }

      // Yangi actionni yaratish
      const newAction = {
        action: "deleted",
        adminId: req.admin.id, // Admin ID (req.admin'dan kelgan)
        timestamp: moment().tz("Asia/Tashkent").format(), // Vaqtni Tashkent vaqt zonasida olish
      };

      // actionsTaken massivini yangilash
      const updatedActions = [...(product.actionsTaken || []), newAction];

      // Mahsulotni yangilash
      await product.update(
        {
          deleted: true, // Deleted flag'ini o'zgartirish
          actionsTaken: updatedActions, // actionsTakenni yangilash
        },
        {
          fields: ["deleted", "actionsTaken"], // Faqat kerakli maydonlarni yangilash
        }
      );

      res.status(200).json({
        message: "Product deleted successfully",
        status: 200,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },

  async searchProduct(req, res) {
    try {
      const { name } = req.query;

      if (!name) {
        return res.status(400).json({
          status: 400,
          message: "Name parameter is required",
        });
      }

      const products = await Products.findAll({
        where: {
          name: {
            [Op.like]: `%${name}%`, // Qisman moslik (LIKE)
          },
        },
      });

      res.status(200).json({
        status: 200,
        message: "Products fetched successfully",
        data: products,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, amount } = req.body;

      const product = await Products.findByPk(id);
      if (!product) {
        return res.status(404).json({ message: "Mahsulot topilmadi!" });
      }

      if (name) {
        product.name = name.trim();
      }

      let updatedActions = [...(product.actionsTaken || [])];

      if (amount) {
        const parsedAmount = Number(amount);
        if (isNaN(parsedAmount)) {
          return res
            .status(400)
            .json({ message: "Amount noto'g'ri formatda!" });
        }
        product.totalAmount += parsedAmount;
        product.remainingAmount += parsedAmount;

        // Yangi actionni qo'shish
        updatedActions.push({
          action: "update amount or name",
          adminId: req.admin.id,
          timestamp: moment().tz("Asia/Tashkent").format(),
        });
      }

      // Mahsulotni yangilash
      await product.update(
        {
          name: product.name,
          totalAmount: product.totalAmount,
          remainingAmount: product.remainingAmount,
          actionsTaken: updatedActions,
        },
        {
          fields: [
            "name",
            "totalAmount",
            "totalPrice",
            "remainingAmount",
            "actionsTaken",
          ],
        }
      );

      res.status(200).json({
        message: "Mahsulot muvaffaqiyatli yangilandi!",
        product,
      });
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },

  async download(req, res) {
    try {
      const products = await Products.findAll({ where: { deleted: false } });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Mahsulotlar");

      worksheet.columns = [
        { header: "ID", key: "id", width: 10 },
        { header: "Nomi", key: "name", width: 30 },
        { header: "Mahsulot rasmi", key: "productImage", width: 50 }, // URL bo'lgani uchun kengligini oshirdik
        { header: "Sotilgan miqdor", key: "quantitySold", width: 15 },
        { header: "Qolgan miqdor", key: "remainingAmount", width: 15 },
        { header: "Jami miqdor", key: "totalAmount", width: 15 },
        { header: "Narxi", key: "price", width: 10 },
        { header: "Umumiy narx", key: "totalPrice", width: 15 },
        { header: "Daromad", key: "revenue", width: 15 },
      ];

      // Har bir mahsulotni Excelga qo'shishdan oldin productImage ni to'liq URL qilish
      products.forEach((product) => {
        const productData = product.toJSON();
        productData.productImage = `http://localhost:1218${productData.productImage}`;
        worksheet.addRow(productData);
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=products.xlsx"
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
        status: 500,
      });
    }
  },
};
